import { NextResponse } from "next/server";
import { UnauthenticatedError } from "@/lib/auth";
import { replaceVehicleDocument } from "@/lib/vehicles/documents/replace-vehicle-document";
import { runRegistrationAnalysis } from "@/lib/vehicles/registration-review/run-registration-analysis";
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
      // Phase 3C Slice 3A (Fix 3) — a successful replace re-runs the owner-scoped, idempotent
      // extraction so the NEW document hash is processed (never inside the upload tx; failure never
      // rolls back the replace). If a non-registration doc was replaced, the registration extraction
      // is unchanged (idempotent no-op).
      if (result.ok) {
        try {
          await runRegistrationAnalysis(vehicleId);
        } catch {
          /* replace is authoritative — extraction failure is surfaced on the page, never fatal here */
        }
      }
      return NextResponse.redirect(dest(result.ok ? "?docNotice=replaced" : `?docError=${result.error}`), 303);
    } catch (error) {
      if (error instanceof UnauthenticatedError) return NextResponse.redirect(new URL(`/${locale}/login`, request.url), 303);
      throw error;
    }
  });
}
