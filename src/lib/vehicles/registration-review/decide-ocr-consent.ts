import "server-only";
import { prisma } from "@/lib/db";
import { requireApprovedProvider } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { safeErrorCategory } from "@/lib/vehicles/documents/safe-error-category";
import { getRegistrationOcrPolicy } from "@/lib/vehicles/registration-extraction/ocr/get-registration-document-reader";
import { recordOcrConsentDecision, OcrConsentInputError, type OcrConsentDecision } from "@/lib/vehicles/registration-extraction/ocr/ocr-consent";
import { runRegistrationAnalysis } from "./run-registration-analysis";
import type { RegistrationAnalysisResult, RegistrationReviewCode } from "./registration-review-result";

// Phase 3C (registration OCR privacy gate) — the provider DECIDES, for ONE registration document,
// whether it may be sent to the external AI processor to suggest the vehicle details (GRANTED), or
// whether they will enter the details themselves (DECLINED). Owner-scoped and session-derived like
// every registration-review mutation: the provider is re-read from the session and the asset + its
// VEHICLE_REGISTRATION document are re-read under that provider id; a client can never decide for
// another provider's document.
//
// ORDER MATTERS: the decision is written durably (row + audit, one transaction) BEFORE the reading
// is started. The extraction service then re-reads the effective consent itself — this function
// does not "unlock" anything by passing a flag; the stored, current, document-bound GRANTED row is
// what lets a byte leave. A DECLINED decision starts nothing and sends nothing; the review form is
// simply the manual-entry path. Declining never blocks creating the vehicle.
//
// A GRANTED decision requires the owner/authorized attestation; without it nothing is written.

export type OcrConsentDecisionInput = {
  ownerAuthorizationConfirmed: boolean;
  /** Interface language the notice was shown in (one of the 8 supported locales). */
  locale: string;
};

export type OcrConsentDecisionResult =
  | { ok: true; decision: OcrConsentDecision; analysis: RegistrationAnalysisResult | null }
  | { ok: false; code: RegistrationReviewCode };

export async function decideRegistrationOcrConsent(vehicleId: string, decision: OcrConsentDecision, input: OcrConsentDecisionInput): Promise<OcrConsentDecisionResult> {
  if (!isValidUuid(vehicleId)) return { ok: false, code: "VEHICLE_NOT_FOUND" };
  const { barqUser, provider } = await requireApprovedProvider();

  // No notice configured = automatic reading is not available here; there is nothing to consent to.
  const policy = getRegistrationOcrPolicy();
  if (!policy) return { ok: false, code: "OCR_NOT_AVAILABLE" };

  const asset = await prisma.asset.findFirst({
    where: { id: vehicleId, providerId: provider.id, assetType: "VEHICLE" },
    select: { id: true, documents: { where: { type: "VEHICLE_REGISTRATION" }, select: { id: true, registrationExtraction: { select: { documentSha256: true } } } } },
  });
  if (!asset) return { ok: false, code: "VEHICLE_NOT_FOUND" };
  const doc = asset.documents[0];
  if (!doc) return { ok: false, code: "DOCUMENT_NOT_FOUND" };
  // A GRANTED decision is bound to the EXACT bytes in storage — of the COMPLETE ORDERED SET (the
  // PDF, the one photo, or front + back): the server-computed set hash on the extraction row the
  // upload (or a previous analysis) left behind. Replacing, adding, removing or swapping a side
  // changes that hash, so a decision given for the old set never covers the new one. Without a hash
  // there is nothing to bind to yet — the provider analyzes first (which never sends anything
  // without consent).
  const documentSha256 = doc.registrationExtraction?.documentSha256 ?? null;
  if (decision === "GRANTED" && !documentSha256) return { ok: false, code: "EXTRACTION_NOT_READY" };

  try {
    await prisma.$transaction((tx) =>
      recordOcrConsentDecision(
        tx,
        {
          providerId: provider.id,
          userId: barqUser.id,
          assetId: asset.id,
          assetDocumentId: doc.id,
          documentSha256,
          decision,
          ownerAuthorizationConfirmed: input.ownerAuthorizationConfirmed === true,
          locale: input.locale,
        },
        policy,
      ),
    );
  } catch (error) {
    if (error instanceof OcrConsentInputError) {
      if (error.reason === "OWNER_AUTHORIZATION_REQUIRED") return { ok: false, code: "OWNER_AUTHORIZATION_REQUIRED" };
      if (error.reason === "DOCUMENT_HASH_REQUIRED") return { ok: false, code: "EXTRACTION_NOT_READY" };
      return { ok: false, code: "INVALID_INPUT" };
    }
    logger.error("registrationOcrConsent.write_failed", { vehicleId, error: safeErrorCategory(error) });
    return { ok: false, code: "UNKNOWN_ERROR" };
  }

  if (decision === "DECLINED") return { ok: true, decision, analysis: null };

  // Consent is on record → start the reading. Its outcome is reported, never treated as part of the
  // consent (a failed or slow reading leaves the GRANTED decision in place and the review retryable).
  try {
    const analysis = await runRegistrationAnalysis(vehicleId);
    return { ok: true, decision, analysis };
  } catch (error) {
    logger.error("registrationOcrConsent.analysis_failed", { vehicleId, error: safeErrorCategory(error) });
    return { ok: true, decision, analysis: { ok: false, code: "EXTRACTION_FAILED" } };
  }
}
