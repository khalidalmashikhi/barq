import { NextResponse } from "next/server";
import { UnauthenticatedError } from "@/lib/auth";
import { uploadVehicleDocument } from "@/lib/vehicles/documents/upload-vehicle-document";
import { runRegistrationAnalysis } from "@/lib/vehicles/registration-review/run-registration-analysis";
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
    // JSON when asked for (the fetch-based upload form: progress, on-screen errors, retry);
    // otherwise the progressive-form 303 redirect. Same behavior either way.
    const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");
    const failed = (code: string) =>
      wantsJson ? NextResponse.json({ ok: false, error: code }, { status: 400 }) : NextResponse.redirect(dest(`?docError=${code}`), 303);
    try {
      const type = formData.get("type");
      const file = formData.get("file");
      if (typeof type !== "string") return failed("INVALID_INPUT");
      if (!(file instanceof File) || file.size === 0) return failed("EMPTY_FILE");

      const claimedExpiryDate = formData.get("claimedExpiryDate");
      const result = await uploadVehicleDocument(vehicleId, {
        type,
        originalFilename: file.name,
        declaredMimeType: file.type,
        bytes: await file.arrayBuffer(),
        claimedExpiryDate: typeof claimedExpiryDate === "string" ? claimedExpiryDate : null,
      });
      // Phase 3C Slice 3A (Fix 3) — auto-start native-PDF extraction AFTER the upload commits, as a
      // SEPARATE owner-scoped operation (re-resolves provider + ownership, idempotent service). Its
      // failure NEVER rolls back the authoritative upload; the detail page shows the extraction
      // status + a Retry control. Only the registration document is extracted.
      if (result.ok && type === "VEHICLE_REGISTRATION") {
        try {
          await runRegistrationAnalysis(vehicleId);
        } catch {
          /* upload is authoritative — extraction failure is surfaced on the page, never fatal here */
        }
      }
      if (!result.ok) return failed(result.error);
      return wantsJson ? NextResponse.json({ ok: true }) : NextResponse.redirect(dest("?docNotice=uploaded"), 303);
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        return wantsJson
          ? NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 })
          : NextResponse.redirect(new URL(`/${locale}/login`, request.url), 303);
      }
      throw error;
    }
  });
}
