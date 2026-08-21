import { NextResponse } from "next/server";
import { UnauthenticatedError } from "@/lib/auth";
import { uploadVehicleDocument } from "@/lib/vehicles/documents/upload-vehicle-document";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// VEHICLE-LC2 — provider vehicle-document UPLOAD. Route handler (not a server
// action) so a multipart upload up to the 4 MB cap bypasses the 1 MB action body
// limit — same reason as the provider-document route. Thin: parse multipart,
// delegate to the self-authorizing uploadVehicleDocument() (requireApprovedProvider
// + asset ownership + registry type + magic-byte/MIME/size validation +
// private-bucket write). Provider identity + vehicle ownership come only from the
// server; there is no providerId input to trust. Progressive-<form> 303 redirect
// back to the vehicle detail (JSON/native transport deferred to VEHICLE-LC2B).

const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
function resolveLocale(v: FormDataEntryValue | null): string {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v) ? v : "ar";
}

export async function POST(request: Request, ctx: { params: Promise<{ vehicleId: string }> }) {
  return withRequestTracing("provider.vehicles.documents.upload", async () => {
    const { vehicleId } = await ctx.params;
    const formData = await request.formData();
    const locale = resolveLocale(formData.get("locale"));
    const dest = (q: string) => new URL(`/${locale}/provider/vehicles/${vehicleId}${q}`, request.url);
    try {
      const type = formData.get("type");
      const file = formData.get("file");
      if (typeof type !== "string") return NextResponse.redirect(dest("?docError=INVALID_INPUT"), 303);
      if (!(file instanceof File) || file.size === 0) return NextResponse.redirect(dest("?docError=EMPTY_FILE"), 303);

      const claimedExpiryDate = formData.get("claimedExpiryDate");
      const result = await uploadVehicleDocument(vehicleId, {
        type,
        originalFilename: file.name,
        declaredMimeType: file.type,
        bytes: await file.arrayBuffer(),
        claimedExpiryDate: typeof claimedExpiryDate === "string" ? claimedExpiryDate : null,
      });
      return NextResponse.redirect(dest(result.ok ? "?docNotice=uploaded" : `?docError=${result.error}`), 303);
    } catch (error) {
      if (error instanceof UnauthenticatedError) return NextResponse.redirect(new URL(`/${locale}/login`, request.url), 303);
      throw error;
    }
  });
}
