import { NextResponse } from "next/server";
import { UnauthenticatedError } from "@/lib/auth";
import { startVehicleOnboarding, type StartOnboardingErrorCode } from "@/lib/vehicles/onboarding/start-vehicle-onboarding";
import { runRegistrationAnalysis } from "@/lib/vehicles/registration-review/run-registration-analysis";
import { MAX_UPLOAD_BYTES } from "@/lib/vehicles/documents/document-upload-policy";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// Phase 3C — Vehicle Creation from Registration, Slice 3B. Step 1 of the document-first onboarding:
// the registration document is uploaded and a blank, non-public shell + its document are created
// together by startVehicleOnboarding (general vehicle authority: an approved provider — never the
// rental workspace or a vertical). A route handler, not a server action, so a multipart body up to
// the upload ceiling is accepted.
//
// IDEMPOTENT ON THE SERVER: the form's `requestKey` is bound to the provider and recorded in a
// durable request row that outlives the setup it produces. A double tap, a retry after a dropped
// connection, a reload or two racing requests yield ONE setup — the others are answered with that
// same setup — and a key whose setup was cancelled is answered "cancelled" and can never create
// another. Nothing here relies on the button.
//
// After a successful start, native-PDF text extraction is attempted (non-fatal; photos and scans go
// to honest manual review — there is no OCR). No Vehicle values are written here; that happens only
// at the provider's confirmed finalize.
//
// Two response styles, same behavior: JSON when the caller asks for it (the upload form uses fetch
// so it can show progress, keep errors on screen and retry with the same key), otherwise the
// progressive-form 303 redirect.

export const maxDuration = 30;

const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
function resolveLocale(v: FormDataEntryValue | null): string {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v) ? v : "ar";
}

// The uploader's own file/input → 400; not-approved → 403; a request-level outcome (cancelled /
// still in progress) → 409; storage/transient → 503; else 500.
const CLIENT_ERRORS: ReadonlySet<string> = new Set([
  "INVALID_INPUT", "EMPTY_FILE", "TOO_LARGE", "UNSUPPORTED_TYPE", "SIGNATURE_MISMATCH", "HEIC_UNSUPPORTED", "IMAGE_TOO_LARGE", "IMAGE_CORRUPT", "PDF_ENCRYPTED", "PDF_CORRUPT", "PDF_TOO_MANY_PAGES",
]);
function statusFor(code: StartOnboardingErrorCode): number {
  if (CLIENT_ERRORS.has(code)) return 400;
  if (code === "ONBOARDING_CANCELLED" || code === "ONBOARDING_IN_PROGRESS") return 409;
  if (code === "PROVIDER_NOT_APPROVED" || code === "NO_PROVIDER_PROFILE") return 403;
  if (code === "STORAGE_NOT_CONFIGURED" || code === "UPLOAD_FAILED") return 503;
  return 500;
}

export async function POST(request: Request) {
  return withRequestTracing("provider.vehicles.onboarding.upload", async () => {
    const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      // Unparseable / truncated multipart body (e.g. the connection dropped mid-upload).
      return wantsJson
        ? NextResponse.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 })
        : NextResponse.redirect(new URL("/ar/provider/vehicles/new?uploadError=INVALID_INPUT", request.url), 303);
    }
    const locale = resolveLocale(formData.get("locale"));

    const fail = (code: StartOnboardingErrorCode) =>
      wantsJson
        ? NextResponse.json({ ok: false, error: code }, { status: statusFor(code) })
        : NextResponse.redirect(new URL(`/${locale}/provider/vehicles/new?uploadError=${code}`, request.url), 303);

    try {
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) return fail("EMPTY_FILE");
      if (file.size > MAX_UPLOAD_BYTES) return fail("TOO_LARGE"); // before the bytes are read or parsed

      const result = await startVehicleOnboarding({
        requestKey: formData.get("requestKey"),
        originalFilename: file.name,
        declaredMimeType: file.type,
        bytes: await file.arrayBuffer(),
      });
      if (!result.ok) return fail(result.error);

      // Native-PDF extraction — a SEPARATE owner-scoped, idempotent, concurrency-safe operation
      // (also safe to run for a replay). Its failure never undoes the upload; the review step shows
      // the status with a retry, or the manual-review path.
      try {
        await runRegistrationAnalysis(result.vehicleId);
      } catch {
        /* non-fatal — surfaced on the review step */
      }

      // The vehicle id is the caller's own; the request key and storage key are never returned.
      const path = `/provider/vehicles/new/${result.vehicleId}${result.replayed ? "?resumed=1" : ""}`;
      return wantsJson
        ? NextResponse.json({ ok: true, redirectTo: path, replayed: result.replayed })
        : NextResponse.redirect(new URL(`/${locale}${path}`, request.url), 303);
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
