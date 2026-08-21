import { NextResponse } from "next/server";
import { UnauthenticatedError } from "@/lib/auth";
import { replaceVehicleDocument } from "@/lib/vehicles/documents/replace-vehicle-document";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// VEHICLE-LC2 — replace one of the caller's own vehicle documents (multipart).
// Ownership + editable-state + PENDING/REJECTED policy are enforced by the domain
// action (docId → Asset → Provider); this handler is a thin multipart→303 adapter.

const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
function resolveLocale(v: FormDataEntryValue | null): string {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v) ? v : "ar";
}

export async function POST(request: Request, ctx: { params: Promise<{ vehicleId: string; docId: string }> }) {
  return withRequestTracing("provider.vehicles.documents.replace", async () => {
    const { vehicleId, docId } = await ctx.params;
    const formData = await request.formData();
    const locale = resolveLocale(formData.get("locale"));
    const dest = (q: string) => new URL(`/${locale}/provider/vehicles/${vehicleId}${q}`, request.url);
    try {
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) return NextResponse.redirect(dest("?docError=EMPTY_FILE"), 303);

      const claimedExpiryDate = formData.get("claimedExpiryDate");
      const result = await replaceVehicleDocument(vehicleId, docId, {
        originalFilename: file.name,
        declaredMimeType: file.type,
        bytes: await file.arrayBuffer(),
        claimedExpiryDate: typeof claimedExpiryDate === "string" ? claimedExpiryDate : null,
      });
      return NextResponse.redirect(dest(result.ok ? "?docNotice=replaced" : `?docError=${result.error}`), 303);
    } catch (error) {
      if (error instanceof UnauthenticatedError) return NextResponse.redirect(new URL(`/${locale}/login`, request.url), 303);
      throw error;
    }
  });
}
