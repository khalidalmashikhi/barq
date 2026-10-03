import { NextResponse } from "next/server";
import { UnauthenticatedError } from "@/lib/auth";
import { createDraftVehicleShell } from "@/lib/vehicles/onboarding/create-draft-shell";
import { deleteDraftVehicle } from "@/lib/vehicles/onboarding/delete-draft-vehicle";
import { uploadVehicleDocument } from "@/lib/vehicles/documents/upload-vehicle-document";
import { runRegistrationAnalysis } from "@/lib/vehicles/registration-review/run-registration-analysis";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// Phase 3C — Vehicle Creation from Registration, Slice 3B. Step 1 of the document-first onboarding
// wizard: the registration document is uploaded BEFORE any Vehicle is created, then a blank DRAFT
// shell receives it and native-PDF extraction is attempted. A route handler (not a server action)
// so a multipart upload up to the document cap bypasses the 1 MB action-body limit (same as the
// detail-page document route).
//
// Order (fail-safe): create the RENTAL_COMPANY-gated DRAFT shell → upload the registration document
// to it → auto-start native-PDF extraction (non-fatal; images/scanned PDFs fall through to the
// wizard's manual-entry path, NO OCR). If the upload fails the just-created empty shell is removed
// so no orphan DRAFT lingers. On success we 303-redirect to step 2 (review & confirm). No Vehicle
// values are written here — only at the provider's confirmed finalize.

const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
function resolveLocale(v: FormDataEntryValue | null): string {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v) ? v : "ar";
}

export async function POST(request: Request) {
  return withRequestTracing("provider.vehicles.onboarding.upload", async () => {
    const formData = await request.formData();
    const locale = resolveLocale(formData.get("locale"));
    const back = (q: string) => new URL(`/${locale}/provider/vehicles/new${q}`, request.url);

    try {
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.redirect(back("?uploadError=EMPTY_FILE"), 303);
      }

      const shell = await createDraftVehicleShell();
      if (!shell.ok) return NextResponse.redirect(back(`?uploadError=${shell.code}`), 303);

      const upload = await uploadVehicleDocument(shell.vehicleId, {
        type: "VEHICLE_REGISTRATION",
        originalFilename: file.name,
        declaredMimeType: file.type,
        bytes: await file.arrayBuffer(),
      });
      if (!upload.ok) {
        // Reclaim the empty shell so a failed first upload never strands a blank DRAFT vehicle.
        await deleteDraftVehicle(shell.vehicleId).catch(() => {});
        return NextResponse.redirect(back(`?uploadError=${upload.error}`), 303);
      }

      // Native-PDF extraction — a SEPARATE owner-scoped operation. Its failure must NOT undo the
      // authoritative upload; the review step shows status + a Retry, or the manual-entry path.
      try {
        await runRegistrationAnalysis(shell.vehicleId);
      } catch {
        /* non-fatal — surfaced on the review step */
      }

      return NextResponse.redirect(new URL(`/${locale}/provider/vehicles/new/${shell.vehicleId}`, request.url), 303);
    } catch (error) {
      if (error instanceof UnauthenticatedError) return NextResponse.redirect(new URL(`/${locale}/login`, request.url), 303);
      throw error;
    }
  });
}
