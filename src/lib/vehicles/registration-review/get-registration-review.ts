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
import { mapExtractedByField } from "./extracted-mapping";
import { columnsToValues } from "./confirmation-record";
import { computeFieldDecisions, type FieldDecision } from "./diff";
import { deriveReviewState, isConfirmationStale, type ReviewState } from "./review-status";

// Phase 3C Slice 3A — the owner-scoped PRIVATE read model for the provider registration review.
// requireApprovedProvider + a providerId-scoped asset query: a foreign/missing/invalid vehicle
// returns null → the page renders notFound() (non-enumerating). Returns only allowlisted private
// fields; never a storage object key, never raw PDF text, never owner/insurance PII.

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
};

export type RegistrationReviewView = {
  vehicleId: string;
  documentId: string | null;
  documentStatus: AssetDocumentStatus | null;
  documentFilename: string | null;
  /** Stored type of the document — lets the review step show an inline preview for an image. */
  documentMimeType: string | null;
  /** How the current suggestions were produced (null when there are none). */
  extractionSource: "NATIVE_PDF_TEXT" | "OCR" | null;
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

export async function getRegistrationReview(vehicleId: string): Promise<RegistrationReviewView | null> {
  if (!isValidUuid(vehicleId)) return null;
  const { provider } = await requireApprovedProvider();

  const asset = await prisma.asset.findFirst({
    where: { id: vehicleId, providerId: provider.id, assetType: "VEHICLE" },
    select: {
      id: true,
      documents: {
        where: { type: "VEHICLE_REGISTRATION" },
        select: {
          id: true,
          status: true,
          originalFilename: true,
          mimeType: true,
          registrationExtraction: {
            select: { id: true, status: true, failureCode: true, documentSha256: true, parserVersion: true, source: true, processingExpiresAt: true, fields: true, lastAttemptedAt: true, lastSucceededAt: true },
          },
          registrationConfirmations: {
            where: { status: { not: "SUPERSEDED" } },
            select: { ...CONFIRMATION_COLUMN_SELECT, status: true, submittedAt: true, boundDocumentSha256: true, boundParserVersion: true },
          },
        },
      },
    },
  });
  if (!asset) return null;

  const doc = asset.documents[0] ?? null;
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

  const extracted = extraction ? mapExtractedByField(extraction.fields) : { values: {}, confidence: {}, warnings: {} };
  const confirmedValues = effectiveConfirmation ? columnsToValues(effectiveConfirmation) : columnsToValues({});
  const decisions = extraction && effectiveConfirmation ? computeFieldDecisions(extracted.values, confirmedValues) : {};

  const reviewState = deriveReviewState(extractionFacts, confirmationFacts);

  const hasSuggestions = !!extraction && (extraction.status === "EXTRACTED" || extraction.status === "NEEDS_REVIEW");
  const extractionSource: "NATIVE_PDF_TEXT" | "OCR" | null = hasSuggestions ? (extraction.source === "OCR" ? "OCR" : "NATIVE_PDF_TEXT") : null;

  const fields: RegistrationReviewFieldView[] = CONFIRMATION_FIELD_KEYS.map((key) => {
    const spec = CONFIRMATION_FIELDS[key];
    const extractedValue = extracted.values[key] ?? null;
    const confidence = extracted.confidence[key] ?? null;
    const confirmedValue = confirmedValues[key];
    const decision = decisions[key] ?? null;
    const warnings = extracted.warnings[key] ?? [];
    // The value the form starts with is the provider's own once they have entered or corrected it;
    // otherwise it is the document-derived suggestion; otherwise nothing.
    const providerOwned = confirmedValue !== null && (decision === null || !decision.matches || decision.source !== "EXTRACTED");
    const source: RegistrationFieldValueSource = providerOwned ? "PROVIDER" : extractedValue !== null && extractionSource ? extractionSource : confirmedValue !== null ? "PROVIDER" : "UNRESOLVED";
    const needsReview =
      source === "PROVIDER"
        ? false
        : source === "UNRESOLVED"
          ? spec.required
          : confidence !== "HIGH" || warnings.includes("CONFLICT") || warnings.includes("OCR_UNCLEAR");
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
    };
  });

  return {
    vehicleId: asset.id,
    documentId: doc?.id ?? null,
    documentStatus: doc?.status ?? null,
    documentFilename: doc?.originalFilename ?? null,
    documentMimeType: doc?.mimeType ?? null,
    extractionSource,
    reviewState,
    lastAttemptedAt: extraction?.lastAttemptedAt ?? null,
    lastSucceededAt: extraction?.lastSucceededAt ?? null,
    confirmation: confirmation ? { status: confirmation.status, submittedAt: confirmation.submittedAt } : null,
    fields,
  };
}
