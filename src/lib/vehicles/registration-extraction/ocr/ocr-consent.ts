import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { isValidLocale } from "@/i18n/locales";
import { REGISTRATION_OCR_PROCESSOR, REGISTRATION_OCR_PURPOSE } from "../constants";
import type { RegistrationOcrPolicy } from "./get-registration-document-reader";

// Phase 3C (registration OCR privacy gate) — the provider's EXPLICIT decision about sending ONE
// registration document to the external AI processor, as durable proof.
//
// • A document may be sent ONLY while its EFFECTIVE consent is GRANTED: the latest decision row
//   for (this document, this provider) says GRANTED, it was given for the CURRENT processing
//   notice (policy version) and the CURRENT processor, AND for the EXACT stored bytes (SHA-256).
//   Anything else — no row, DECLINED, a GRANTED row for an older notice (STALE), another
//   provider's row, a row for another document, a row for the bytes BEFORE a replacement — is
//   "not granted" and the extraction service makes no external call.
// • Decisions are APPEND-ONLY: declining after granting, or granting after declining, is a new
//   row; the newest wins. Nothing is ever edited or deleted here. The rows outlive the setup and
//   the document (both FKs are SET NULL), so the proof survives a cancellation.
// • A GRANTED decision REQUIRES the owner/authorized attestation. Without it the input is invalid
//   and nothing is written.
// • The record holds only what proof of consent needs. It never holds document contents, a
//   document value, the API key or a model id; the audit written with it holds the same metadata.
//
// Legally cautious by design: this module records that a specific notice was shown and accepted;
// it does not by itself make the processing lawful — the operational gate (contracts, assessment,
// privacy policy, approval) is documented separately and must be completed before OCR is enabled.

export type OcrConsentDecision = "GRANTED" | "DECLINED";

export type OcrConsentState =
  /** Latest decision is GRANTED for the current notice + processor → the document may be sent. */
  | "GRANTED"
  /** Latest decision is DECLINED → manual entry; nothing is sent. */
  | "DECLINED"
  /** Latest decision is GRANTED but for an older notice (or another processor) → fresh consent needed. */
  | "STALE"
  /** No decision recorded for this document (or no notice is configured). */
  | "NONE";

export type EffectiveOcrConsent = {
  state: OcrConsentState;
  /** The notice version the latest decision was given for (null when none). */
  policyVersion: string | null;
  decidedAt: Date | null;
};

type DbClient = PrismaClient | Prisma.TransactionClient;

export const NO_CONSENT: EffectiveOcrConsent = { state: "NONE", policyVersion: null, decidedAt: null };

/**
 * Pure classification of the latest decision row against the current notice and the current
 * stored bytes. `currentDocumentSha256` is the hash of the bytes now in storage; a GRANTED row
 * for different bytes (the document was replaced since) is a decision about ANOTHER document and
 * counts as NONE — the provider is asked again. When the caller cannot say which bytes are current
 * (null), a GRANTED row is never treated as current.
 */
export function classifyOcrConsent(
  latest: { decision: OcrConsentDecision; policyVersion: string; processor: string; documentSha256: string | null; createdAt: Date } | null,
  policy: Pick<RegistrationOcrPolicy, "policyVersion" | "processor"> | null,
  currentDocumentSha256: string | null,
): EffectiveOcrConsent {
  if (!latest || !policy) return NO_CONSENT;
  if (latest.decision === "DECLINED") return { state: "DECLINED", policyVersion: latest.policyVersion, decidedAt: latest.createdAt };
  if (!currentDocumentSha256 || latest.documentSha256 !== currentDocumentSha256) return NO_CONSENT; // granted for other bytes (or bytes unknown)
  const current = latest.policyVersion === policy.policyVersion && latest.processor === policy.processor;
  return { state: current ? "GRANTED" : "STALE", policyVersion: latest.policyVersion, decidedAt: latest.createdAt };
}

export function isOcrConsentGranted(consent: EffectiveOcrConsent): boolean {
  return consent.state === "GRANTED";
}

/**
 * The effective decision for ONE document of ONE provider. Scoped by BOTH ids: a consent row is
 * never found through another provider's document, and a provider's consent for one document never
 * covers another (a replacement document is a new document).
 */
export async function getEffectiveOcrConsent(
  db: DbClient,
  scope: { providerId: string; assetDocumentId: string; documentSha256: string },
  policy: Pick<RegistrationOcrPolicy, "policyVersion" | "processor"> | null,
): Promise<EffectiveOcrConsent> {
  if (!policy) return NO_CONSENT;
  const latest = await db.vehicleRegistrationOcrConsent.findFirst({
    where: { assetDocumentId: scope.assetDocumentId, providerId: scope.providerId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { decision: true, policyVersion: true, processor: true, documentSha256: true, createdAt: true },
  });
  return classifyOcrConsent(latest, policy, scope.documentSha256);
}

export class OcrConsentInputError extends Error {
  constructor(public readonly reason: "OWNER_AUTHORIZATION_REQUIRED" | "INVALID_LOCALE" | "DOCUMENT_HASH_REQUIRED") {
    super(`invalid OCR consent input: ${reason}`);
    this.name = "OcrConsentInputError";
  }
}

export type RecordOcrConsentInput = {
  providerId: string;
  userId: string;
  assetId: string;
  assetDocumentId: string;
  /** SHA-256 of the stored bytes a GRANTED decision is about (null for a decline). */
  documentSha256: string | null;
  decision: OcrConsentDecision;
  ownerAuthorizationConfirmed: boolean;
  locale: string;
};

/**
 * Append ONE decision row and its audit record in the caller's transaction. Returns the row id.
 * Throws OcrConsentInputError (nothing written) when a GRANTED decision lacks the attestation or
 * the locale is not one of the supported interface languages.
 */
export async function recordOcrConsentDecision(tx: DbClient, input: RecordOcrConsentInput, policy: RegistrationOcrPolicy): Promise<{ id: string }> {
  if (input.decision === "GRANTED" && input.ownerAuthorizationConfirmed !== true) throw new OcrConsentInputError("OWNER_AUTHORIZATION_REQUIRED");
  if (input.decision === "GRANTED" && !/^[0-9a-f]{64}$/.test(input.documentSha256 ?? "")) throw new OcrConsentInputError("DOCUMENT_HASH_REQUIRED");
  if (!isValidLocale(input.locale)) throw new OcrConsentInputError("INVALID_LOCALE");

  const row = await tx.vehicleRegistrationOcrConsent.create({
    data: {
      providerId: input.providerId,
      userId: input.userId,
      assetId: input.assetId,
      assetDocumentId: input.assetDocumentId,
      documentSha256: input.decision === "GRANTED" ? input.documentSha256 : null,
      decision: input.decision,
      policyVersion: policy.policyVersion,
      processor: policy.processor,
      purpose: policy.purpose,
      inferenceGeo: input.decision === "GRANTED" ? policy.inferenceGeo : null,
      locale: input.locale,
      ownerAuthorizationConfirmed: input.ownerAuthorizationConfirmed === true,
    },
    select: { id: true },
  });

  await recordAuditEvent(
    {
      actorType: "PROVIDER",
      actorId: input.providerId,
      action: input.decision === "GRANTED" ? "vehicle.registration_ocr_consent_granted" : "vehicle.registration_ocr_consent_declined",
      entityType: "Vehicle",
      entityId: input.assetId,
      // Metadata only — the notice the decision refers to. Never a document value, key or secret.
      newValue: {
        decision: input.decision,
        policyVersion: policy.policyVersion,
        processor: policy.processor,
        purpose: policy.purpose,
        inferenceGeo: input.decision === "GRANTED" ? policy.inferenceGeo : null,
        locale: input.locale,
        ownerAuthorizationConfirmed: input.ownerAuthorizationConfirmed === true,
        consentId: row.id,
      },
    },
    tx,
  );
  return row;
}

/** Sanity: the processor/purpose constants the notice names are the ones recorded. */
export const OCR_CONSENT_PROCESSOR = REGISTRATION_OCR_PROCESSOR;
export const OCR_CONSENT_PURPOSE = REGISTRATION_OCR_PURPOSE;
