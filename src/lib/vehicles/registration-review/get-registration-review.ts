import "server-only";
import type { AssetDocumentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApprovedProvider } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import type { RegistrationFieldConfidence } from "@/lib/vehicles/registration-extraction/codes";
import {
  CONFIRMATION_FIELD_KEYS,
  CONFIRMATION_FIELDS,
  type ConfirmationFieldKey,
  type ConfirmationFieldGroup,
  type ConfirmationFieldKind,
} from "./field-model";
import { mapExtractedByField, type ExtractedSuggestions } from "./extracted-mapping";
import { columnsToValues } from "./confirmation-record";
import { computeFieldDecisions, type FieldDecision } from "./diff";
import { deriveReviewState, isConfirmationStale, type ReviewState } from "./review-status";
import { getRegistrationOcrPolicy } from "@/lib/vehicles/registration-extraction/ocr/get-registration-document-reader";
import { classifyOcrConsent, type OcrConsentState } from "@/lib/vehicles/registration-extraction/ocr/ocr-consent";
import { REGISTRATION_SET_TYPES, roleOfRegistrationType, type RegistrationPageRole } from "@/lib/vehicles/registration-extraction/registration-document-set";
import { suggestVehicleType } from "@/lib/vehicles/onboarding/vehicle-type-suggestion";

// Phase 3C Slice 3A — the owner-scoped PRIVATE read model for the provider registration review.
// requireApprovedProvider + a providerId-scoped asset query: a foreign/missing/invalid vehicle
// returns null → the page renders notFound() (non-enumerating). Returns only allowlisted private
// fields; never a storage object key, never raw PDF text, never owner/insurance PII.
//
// The registration is a SET (one PDF, one photo, or front + back photos — see
// registration-document-set.ts): the extraction, the consent and the confirmation all hang off the
// FRONT document, and `pages` lists every side in order so the review step can show them all.

/** Where the value shown for a field comes from — so document-derived values are never confused
 *  with what the provider typed. UNRESOLVED = nothing was read and nothing has been entered. */
export type RegistrationFieldValueSource = "NATIVE_PDF_TEXT" | "OCR" | "PROVIDER" | "UNRESOLVED";

export type RegistrationReviewFieldView = {
  key: ConfirmationFieldKey;
  group: ConfirmationFieldGroup;
  kind: ConfirmationFieldKind;
  sensitive: boolean;
  required: boolean;
  extractedValue: string | number | null;
  confidence: RegistrationFieldConfidence | null;
  confirmedValue: string | number | null;
  decision: FieldDecision | null;
  /** Source of the value the form starts with. */
  source: RegistrationFieldValueSource;
  /** The provider must look at this field: required but unresolved, or read with less than HIGH
   *  confidence (every OCR value), or flagged by a warning (conflict / unclear). */
  needsReview: boolean;
  /** The document showed DIFFERENT values for this field (e.g. front vs back, page 1 vs page 2).
   *  Nothing was chosen: `extractedValue` is null and `alternatives` lists what was seen, in
   *  order, for the provider to pick from or overrule. Private — never public. */
  conflict: boolean;
  alternatives: (string | number)[];
  /** The suggestion was DERIVED from the document's compound description (dictionary split) —
   *  always LOW confidence and flagged; the provider must confirm or correct it. */
  heuristic: boolean;
};

/** The provider's standing decision about EXTERNAL automatic reading of THIS document set, and
 *  what the notice they are (or were) shown says. Null when automatic reading is not available
 *  here — then there is nothing to decide. Never carries a key, a model id or a document value. */
export type RegistrationOcrConsentView = {
  state: OcrConsentState;
  policyVersion: string;
  processor: string;
  inferenceGeo: "us" | "global";
};

/** One side/page of the stored registration set, in order (front first). */
export type RegistrationReviewPageView = {
  documentId: string;
  role: RegistrationPageRole;
  mimeType: string;
  filename: string | null;
  sizeBytes: number;
};

/** What kind of set is stored: one PDF, one photo, or front + back photos. */
export type RegistrationDocumentSetKind = "PDF" | "IMAGE" | "IMAGES";

export type RegistrationReviewView = {
  vehicleId: string;
  /** The FRONT (primary) document — what the extraction, consent and confirmation are bound to. */
  documentId: string | null;
  documentStatus: AssetDocumentStatus | null;
  documentFilename: string | null;
  /** Stored type of the front document — lets the review step show an inline preview for an image. */
  documentMimeType: string | null;
  /** Every stored side/page of the set, front first (empty when there is no document). */
  pages: RegistrationReviewPageView[];
  setKind: RegistrationDocumentSetKind | null;
  /** How the current suggestions were produced (null when there are none). */
  extractionSource: "NATIVE_PDF_TEXT" | "OCR" | null;
  /** The compound vehicle description exactly as printed (private; shown so the provider can
   *  check make / model / type against it). Null when the document printed none. */
  documentDescription: string | null;
  /** A body-style SUGGESTION for the vehicle type derived from the description / make / model /
   *  usage text — never pre-selected: the provider must choose explicitly. Null when nothing is
   *  recognizable. */
  vehicleTypeSuggestion: string | null;
  /** Consent status for external reading of the current set (null = not available here). */
  ocrConsent: RegistrationOcrConsentView | null;
  reviewState: ReviewState;
  lastAttemptedAt: Date | null;
  lastSucceededAt: Date | null;
  confirmation: { status: "DRAFT" | "SUBMITTED" | "SUPERSEDED"; submittedAt: Date | null } | null;
  fields: RegistrationReviewFieldView[];
};

const CONFIRMATION_COLUMN_SELECT = {
  make: true, model: true, modelYear: true, color: true, bookablePassengerCapacity: true,
  licensedPassengerCapacity: true, registeredSeats: true, plateNumber: true, plateType: true,
  vin: true, engineNumber: true, usageClassification: true, engineCapacity: true, emptyWeight: true,
  maximumLoad: true, axleCount: true, licenseValidFrom: true, licenseExpiry: true, firstRegistrationDate: true,
} as const;

const NO_SUGGESTIONS: ExtractedSuggestions = { values: {}, confidence: {}, warnings: {}, alternatives: {}, documentDescription: null };

export async function getRegistrationReview(vehicleId: string): Promise<RegistrationReviewView | null> {
  if (!isValidUuid(vehicleId)) return null;
  const { provider } = await requireApprovedProvider();

  const asset = await prisma.asset.findFirst({
    where: { id: vehicleId, providerId: provider.id, assetType: "VEHICLE" },
    select: {
      id: true,
      documents: {
        where: { type: { in: [...REGISTRATION_SET_TYPES] } },
        select: {
          id: true,
          type: true,
          status: true,
          originalFilename: true,
          mimeType: true,
          sizeBytes: true,
          registrationExtraction: {
            select: { id: true, status: true, failureCode: true, documentSha256: true, parserVersion: true, source: true, processingExpiresAt: true, fields: true, lastAttemptedAt: true, lastSucceededAt: true },
          },
          registrationConfirmations: {
            where: { status: { not: "SUPERSEDED" } },
            select: { ...CONFIRMATION_COLUMN_SELECT, status: true, submittedAt: true, boundDocumentSha256: true, boundParserVersion: true },
          },
          // The LATEST decision of THIS provider about THIS set (consent is provider-scoped).
          registrationOcrConsents: {
            where: { providerId: provider.id },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { decision: true, policyVersion: true, processor: true, documentSha256: true, createdAt: true },
          },
        },
      },
    },
  });
  if (!asset) return null;

  // Ordered: front first, then the optional back. A back side without a front is not a set and is
  // not shown (the front lookup drives everything).
  const front = asset.documents.find((d) => d.type === REGISTRATION_SET_TYPES[0]) ?? null;
  const ordered = front ? REGISTRATION_SET_TYPES.map((type) => asset.documents.find((d) => d.type === type)).filter((d): d is NonNullable<typeof d> => !!d) : [];
  const doc = front;
  const pages: RegistrationReviewPageView[] = doc
    ? ordered.map((d) => ({ documentId: d.id, role: roleOfRegistrationType(d.type)!, mimeType: d.mimeType, filename: d.originalFilename, sizeBytes: d.sizeBytes }))
    : [];
  const setKind: RegistrationDocumentSetKind | null = !doc ? null : doc.mimeType === "application/pdf" ? "PDF" : pages.length === 2 ? "IMAGES" : "IMAGE";

  const extraction = doc?.registrationExtraction ?? null;
  const confirmation = doc?.registrationConfirmations[0] ?? null;

  const extractionFacts = extraction
    ? { status: extraction.status, failureCode: extraction.failureCode, documentSha256: extraction.documentSha256, parserVersion: extraction.parserVersion, processingExpiresAt: extraction.processingExpiresAt }
    : null;
  const confirmationFacts = confirmation
    ? { status: confirmation.status, boundDocumentSha256: confirmation.boundDocumentSha256, boundParserVersion: confirmation.boundParserVersion }
    : null;

  // Fix 1 — a STALE active claim (bound to a replaced document / old parser) must NEVER surface its
  // provider values/decisions as current. Prefill from the new extraction only; the next save
  // supersedes the stale row server-side.
  const stale = isConfirmationStale(confirmationFacts, extractionFacts);
  const effectiveConfirmation = stale ? null : confirmation;

  const extracted = extraction ? mapExtractedByField(extraction.fields) : NO_SUGGESTIONS;
  const confirmedValues = effectiveConfirmation ? columnsToValues(effectiveConfirmation) : columnsToValues({});
  const decisions = extraction && effectiveConfirmation ? computeFieldDecisions(extracted.values, confirmedValues) : {};

  // Automatic reading availability + the notice consent is bound to (environment, never the key).
  const policy = getRegistrationOcrPolicy();
  const reviewState = deriveReviewState(extractionFacts, confirmationFacts, new Date(), { ocrAvailable: policy !== null });
  const ocrConsent: RegistrationOcrConsentView | null = policy
    ? { state: classifyOcrConsent(doc?.registrationOcrConsents[0] ?? null, policy, extraction?.documentSha256 ?? null).state, policyVersion: policy.policyVersion, processor: policy.processor, inferenceGeo: policy.inferenceGeo }
    : null;

  const hasSuggestions = !!extraction && (extraction.status === "EXTRACTED" || extraction.status === "NEEDS_REVIEW");
  const extractionSource: "NATIVE_PDF_TEXT" | "OCR" | null = hasSuggestions ? (extraction.source === "OCR" ? "OCR" : "NATIVE_PDF_TEXT") : null;

  const fields: RegistrationReviewFieldView[] = CONFIRMATION_FIELD_KEYS.map((key) => {
    const spec = CONFIRMATION_FIELDS[key];
    const extractedValue = extracted.values[key] ?? null;
    const confidence = extracted.confidence[key] ?? null;
    const confirmedValue = confirmedValues[key];
    const decision = decisions[key] ?? null;
    const warnings = extracted.warnings[key] ?? [];
    const conflict = hasSuggestions && warnings.includes("CONFLICT");
    const alternatives = conflict ? (extracted.alternatives[key] ?? []) : [];
    const heuristic = hasSuggestions && extractedValue !== null && warnings.includes("HEURISTIC_SPLIT");
    // The value the form starts with is the provider's own once they have entered or corrected it;
    // otherwise it is the document-derived suggestion; otherwise nothing.
    const providerOwned = confirmedValue !== null && (decision === null || !decision.matches || decision.source !== "EXTRACTED");
    const source: RegistrationFieldValueSource = providerOwned ? "PROVIDER" : extractedValue !== null && extractionSource ? extractionSource : confirmedValue !== null ? "PROVIDER" : "UNRESOLVED";
    const needsReview =
      source === "PROVIDER"
        ? false
        : source === "UNRESOLVED"
          ? spec.required || conflict // a conflict is unresolved by design and must be looked at
          : confidence !== "HIGH" || conflict || heuristic || warnings.includes("OCR_UNCLEAR");
    return {
      key,
      group: spec.group,
      kind: spec.kind,
      sensitive: spec.sensitive,
      required: spec.required,
      extractedValue,
      confidence,
      confirmedValue,
      decision,
      source,
      needsReview,
      conflict,
      alternatives,
      heuristic,
    };
  });

  // The body-style HINT for the vehicle type: from the printed description first (it usually
  // carries "station" / "pickup" / "bus"), then the make / model / usage suggestions. Only a
  // suggestion — the form never pre-selects it.
  const documentDescription = hasSuggestions ? extracted.documentDescription : null;
  const typeHint = [documentDescription, extracted.values.make, extracted.values.model, extracted.values.usageClassification]
    .filter((v): v is string | number => v !== null && v !== undefined)
    .map(String)
    .join(" ");
  const vehicleTypeSuggestion = hasSuggestions ? suggestVehicleType(typeHint) : null;

  return {
    vehicleId: asset.id,
    documentId: doc?.id ?? null,
    documentStatus: doc?.status ?? null,
    documentFilename: doc?.originalFilename ?? null,
    documentMimeType: doc?.mimeType ?? null,
    pages,
    setKind,
    extractionSource,
    documentDescription,
    vehicleTypeSuggestion,
    ocrConsent,
    reviewState,
    lastAttemptedAt: extraction?.lastAttemptedAt ?? null,
    lastSucceededAt: extraction?.lastSucceededAt ?? null,
    confirmation: confirmation ? { status: confirmation.status, submittedAt: confirmation.submittedAt } : null,
    fields,
  };
}
