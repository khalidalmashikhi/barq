import "server-only";
import { prisma } from "@/lib/db";
import { requireApprovedProvider } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { runRegistrationCompletion, type ExtractionServiceDeps } from "@/lib/vehicles/registration-extraction/extract-registration-service";
import { isConfirmationStale } from "./review-status";
import type { RegistrationReviewCode } from "./registration-review-result";

// Phase 3C (incomplete native-PDF correction, 2026-10-09) — "Complete automatic reading".
//
// Owner-scoped, session-derived adapter over the extraction service's consent-gated completion of
// an INCOMPLETE native-PDF reading. Nothing is sent unless the service's own gates all pass — the
// provider's current GRANTED consent for the exact set hash is re-read by the service itself; this
// function unlocks nothing. Manual entry stays open whatever happens here.

export type CompletionActionResult =
  | { ok: true; outcome: "COMPLETED" | "REUSED" | "ALREADY_COMPLETED" | "IN_PROGRESS" }
  | { ok: false; code: RegistrationReviewCode };

export async function completeRegistrationReading(vehicleId: string, deps?: ExtractionServiceDeps): Promise<CompletionActionResult> {
  if (!isValidUuid(vehicleId)) return { ok: false, code: "VEHICLE_NOT_FOUND" };
  const { barqUser, provider } = await requireApprovedProvider();

  const asset = await prisma.asset.findFirst({
    where: { id: vehicleId, providerId: provider.id, assetType: "VEHICLE" },
    select: {
      documents: {
        where: { type: "VEHICLE_REGISTRATION" },
        select: {
          id: true,
          registrationExtraction: { select: { status: true, failureCode: true, documentSha256: true, parserVersion: true, processingExpiresAt: true } },
          registrationConfirmations: { where: { status: { not: "SUPERSEDED" } }, select: { status: true, boundDocumentSha256: true, boundParserVersion: true } },
        },
      },
    },
  });
  if (!asset) return { ok: false, code: "VEHICLE_NOT_FOUND" };
  const doc = asset.documents[0];
  if (!doc) return { ok: false, code: "DOCUMENT_NOT_FOUND" };
  const active = doc.registrationConfirmations[0] ?? null;
  if (active && active.status === "SUBMITTED" && !isConfirmationStale(active, doc.registrationExtraction)) return { ok: false, code: "LOCKED" };

  const res = await runRegistrationCompletion({ assetDocumentId: doc.id, actorUserId: barqUser.id }, deps);
  if (res.ok) return { ok: true, outcome: res.outcome };
  switch (res.error) {
    case "DOCUMENT_NOT_FOUND":
      return { ok: false, code: "DOCUMENT_NOT_FOUND" };
    case "STORAGE_NOT_CONFIGURED":
      return { ok: false, code: "STORAGE_NOT_CONFIGURED" };
    case "OCR_NOT_AVAILABLE":
      return { ok: false, code: "OCR_NOT_AVAILABLE" };
    case "CONSENT_REQUIRED":
      return { ok: false, code: "OCR_CONSENT_REQUIRED" };
    case "RESULT_STALE":
      return { ok: false, code: "RESULT_STALE" };
    case "RATE_LIMITED":
      return { ok: false, code: "OCR_RATE_LIMITED" };
    case "ATTEMPT_LIMIT":
      return { ok: false, code: "OCR_ATTEMPT_LIMIT" };
    case "READ_FAILED":
    case "DOWNLOAD_FAILED":
      return { ok: false, code: "COMPLETION_FAILED" };
    case "NOT_APPLICABLE":
    case "NOT_NEEDED":
    case "INPUT_TOO_LARGE":
      return { ok: false, code: "COMPLETION_NOT_AVAILABLE" };
    default:
      return { ok: false, code: "UNKNOWN_ERROR" };
  }
}
