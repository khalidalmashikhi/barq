import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { getRequestId } from "@/lib/observability/request-context";
import { isDocumentStorageConfigured, downloadPrivateObject } from "@/lib/storage/storage";
import { consumeRateLimit } from "@/lib/rate-limit/durable-rate-limiter";
import { getRegistrationOcrRateLimit } from "@/lib/rate-limit/rate-limit-config";
import { safeErrorCategory } from "@/lib/vehicles/documents/safe-error-category";
import {
  REGISTRATION_PARSER_VERSION,
  REGISTRATION_EXTRACTION_SOURCE,
  REGISTRATION_OCR_SOURCE,
  REGISTRATION_OCR_LEASE_MS,
  MAX_OCR_CALLS_PER_DOCUMENT,
  type RegistrationExtractionSource,
} from "./constants";
import { parseOmanVehicleRegistration, buildRegistrationExtraction } from "./parse-registration";
import { extractPdfText, type PdfTextResult } from "./pdf-text";
import { serializePersistedFields, serializeWarnings, extractionTypedColumns, persistedFieldsSchema, type ExtractionTypedColumns } from "./record";
import { isExtractionInProgress } from "./processing-lease";
import { getRegistrationDocumentReader, getRegistrationOcrPolicy, type RegistrationOcrPolicy } from "./ocr/get-registration-document-reader";
import { getEffectiveOcrConsent, isOcrConsentGranted, type EffectiveOcrConsent } from "./ocr/ocr-consent";
import { isRegistrationReadableMimeType, type RegistrationDocumentReader, type RegistrationReadResult } from "./ocr/registration-document-reader";
import type { RegistrationExtractionStatus, RegistrationRecordStatus } from "./codes";
import type { VehicleRegistrationExtractionResult } from "./types";

// Phase 3C — Vehicle Registration Extraction. Server-only orchestration turning an
// already-authorized VEHICLE_REGISTRATION document into a PRIVATE extraction CANDIDATE. It NEVER
// mutates the Vehicle, NEVER exposes a route/action/cron/UI, and NEVER trusts a client-supplied
// provider identity (its ONLY input is a document id, plus — optionally — the acting user's id for
// the OCR call budget).
//
// TWO TIERS, IN THIS ORDER
//   1. NATIVE PDF TEXT — deterministic local extraction. Always tried first for a PDF; no external
//      call is ever made for a document that has a usable text layer.
//   2. OCR — ONLY for a photo or a scanned / image-only PDF, only when an OCR engine is configured,
//      and ONLY with the provider's recorded consent for THIS document. The engine reports the text
//      it sees per allowlisted field; the SAME deterministic normalizers/validators then build the
//      result, capped so that an OCR value is always "needs review". With no engine configured the
//      document simply stays on the manual path (FAILED / OCR_NOT_CONFIGURED); with no consent it
//      waits for the provider's choice (FAILED / OCR_CONSENT_REQUIRED) — in both cases nothing is
//      sent anywhere and nothing is invented.
//
// THE GATES IN FRONT OF THE EXTERNAL CALL, in order — every one of them stops before any byte leaves:
//   • readable type and a configured engine + processing notice (fail closed);
//   • CONSENT: the latest decision for (this document, this provider) is GRANTED for the current
//     notice version and processor — never another provider's, another document's or a stale one;
//   • REUSE: identical bytes already read for this provider by this engine → no call at all;
//   • the per-document CEILING on external calls (MAX_OCR_CALLS_PER_DOCUMENT);
//   • the LEASE (exactly one attempt per document at a time);
//   • the durable, fail-closed CALL BUDGET per provider and per acting user (rate limit).
//   And after the call: the engine's REPORTED inference geography must equal the configured one —
//   otherwise the answer is discarded unread (OCR_GEO_MISMATCH); there is no fallback geography.
//
// STATE MACHINE (one row per document; update-in-place, NOT immutable versions):
//   existing EXTRACTED/NEEDS_REVIEW + same hash & parser version → idempotent no-op (no re-parse,
//     NO second OCR call, no duplicate audit) — this is what makes retry / reload / replay cheap;
//   existing FAILED (same hash & version) → RETRYABLE;
//   parser version changed OR document hash changed → reprocess (a replaced document re-extracts);
//   PROCESSING → one attempt holds a LEASE while an OCR call is in flight. A second request for
//     the same bytes does no work and reports PROCESSING; an expired lease may be taken over.
//
// ONE EFFECTIVE OCR PER DOCUMENT
//   • the lease guarantees at most one external call at a time per document;
//   • an OCR result is REUSED for identical bytes already read for the SAME provider with the same
//     engine (matched by the server-computed SHA-256 — never across providers);
//   • completion is a guarded update on the lease token, so a late answer for a document that was
//     cancelled (row deleted), replaced or taken over is DISCARDED — it can never resurrect a
//     cancelled setup or overwrite a newer result;
//   • completion and its audit share ONE transaction: an audit or database failure leaves the row
//     NOT complete, and it is handed back as a retryable failure.
//
// Nothing here logs document bytes, OCR text, a plate, a VIN, a request or response body, or a
// provider error message — log context is a fixed set of ids and error CATEGORIES.

export type RunExtractionInput = {
  assetDocumentId: string;
  /** The signed-in user on whose request this runs (OCR call budget). Null for system/replay paths. */
  actorUserId?: string | null;
};

export type RunExtractionResult =
  | { ok: true; extractionId: string; status: RegistrationRecordStatus; failureCode: string | null; idempotent: boolean }
  | { ok: false; error: "DOCUMENT_NOT_FOUND" | "WRONG_DOCUMENT_TYPE" | "NOT_A_VEHICLE" | "STORAGE_NOT_CONFIGURED" | "DOWNLOAD_FAILED" | "UNKNOWN_ERROR" };

export type OcrBudgetScope = { providerId: string; userId: string | null };

// Injectable seams (tests / disposable-DB proofs). Defaults use the real adapter, storage, the
// environment-configured OCR engine + notice (or none), the real consent table, the durable rate
// limiter and the global prisma client.
export type ExtractionServiceDeps = {
  db: PrismaClient;
  extractPdfText: (bytes: ArrayBuffer) => Promise<PdfTextResult>;
  downloadPrivateObject: (objectKey: string) => Promise<ArrayBuffer>;
  isStorageConfigured: () => boolean;
  /** The OCR engine for this environment, or null when none is configured (fail closed). */
  getReader: () => RegistrationDocumentReader | null;
  /** The processing notice consent is bound to, or null when OCR is not configured. */
  getPolicy: () => RegistrationOcrPolicy | null;
  /** The provider's effective decision for ONE document (never another provider's). */
  readConsent: (db: PrismaClient, scope: { providerId: string; assetDocumentId: string; documentSha256: string }, policy: RegistrationOcrPolicy) => Promise<EffectiveOcrConsent>;
  /** Consume ONE unit of the external-call budget for the provider and the acting user. Fail closed. */
  consumeOcrBudget: (scope: OcrBudgetScope) => Promise<"ALLOWED" | "LIMITED">;
};

async function consumeOcrBudgetWithDurableLimiter(scope: OcrBudgetScope): Promise<"ALLOWED" | "LIMITED"> {
  const { limit, windowMs } = getRegistrationOcrRateLimit();
  const windowSeconds = Math.ceil(windowMs / 1000);
  // Keys are opaque ids, never a phone/email/name; the limiter never logs them.
  const keys = [`registration-ocr:provider:${scope.providerId}`, ...(scope.userId ? [`registration-ocr:user:${scope.userId}`] : [])];
  for (const key of keys) {
    const res = await consumeRateLimit(key, limit, windowSeconds);
    if (!res.allowed) return "LIMITED";
  }
  return "ALLOWED";
}

const defaultDeps: ExtractionServiceDeps = {
  db: prisma,
  extractPdfText: (bytes) => extractPdfText(bytes),
  downloadPrivateObject,
  isStorageConfigured: isDocumentStorageConfigured,
  getReader: () => getRegistrationDocumentReader(),
  getPolicy: () => getRegistrationOcrPolicy(),
  readConsent: (db, scope, policy) => getEffectiveOcrConsent(db, scope, policy),
  consumeOcrBudget: consumeOcrBudgetWithDurableLimiter,
};

const MAX_PERSIST_ATTEMPTS = 3;

function sha256Hex(bytes: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

const NO_TYPED: ExtractionTypedColumns = { extractedVin: null, extractedPlateNumber: null, extractedLicensedPassengerCapacity: null, extractedManufactureYear: null, licenseExpiryDate: null };

type Computed = {
  status: RegistrationExtractionStatus;
  failureCode: string | null;
  fields: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  warnings: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  typed: ExtractionTypedColumns;
  success: boolean;
  source: RegistrationExtractionSource;
  /** Operational metadata for an OCR result (engine + version); null for native text. */
  ocrEngine: string | null;
  /** The inference geography the engine REPORTED for a stored OCR result; null otherwise. */
  ocrInferenceGeo: string | null;
  /** The geography the reader was CONFIGURED for (audit record only). */
  configuredInferenceGeo: string | null;
  /** Counts only — for the audit record. Never values. */
  fieldsRead: number;
  fieldsNeedingReview: number;
};

function failed(failureCode: string, source: RegistrationExtractionSource, ocrEngine: string | null, configuredInferenceGeo: string | null = null): Computed {
  return { status: "FAILED", failureCode, fields: Prisma.JsonNull, warnings: Prisma.JsonNull, typed: NO_TYPED, success: false, source, ocrEngine, ocrInferenceGeo: null, configuredInferenceGeo, fieldsRead: 0, fieldsNeedingReview: 0 };
}

function fromParsed(parsed: VehicleRegistrationExtractionResult, ocr: { engine: string; reportedGeo: string | null; configuredGeo: string | null } | null, unreadableCode: string): Computed {
  // A parse that produced no usable field is NOT a success.
  if (parsed.overallStatus === "FAILED") return failed(unreadableCode, parsed.source, ocr?.engine ?? null, ocr?.configuredGeo ?? null);
  const all = Object.values(parsed.fields);
  return {
    status: parsed.overallStatus,
    failureCode: null,
    fields: serializePersistedFields(parsed),
    warnings: serializeWarnings(parsed),
    typed: extractionTypedColumns(parsed),
    success: true,
    source: parsed.source,
    ocrEngine: ocr?.engine ?? null,
    ocrInferenceGeo: ocr?.reportedGeo ?? null,
    configuredInferenceGeo: ocr?.configuredGeo ?? null,
    fieldsRead: all.filter((f) => f.normalizedValue !== null).length,
    fieldsNeedingReview: all.filter((f) => f.normalizedValue !== null && f.confidence !== "HIGH").length,
  };
}

function computeFromPdf(pdfResult: PdfTextResult): Computed {
  if (!pdfResult.ok) return failed(pdfResult.code, REGISTRATION_EXTRACTION_SOURCE, null);
  return fromParsed(parseOmanVehicleRegistration(pdfResult.text), null, "UNSUPPORTED_LAYOUT");
}

function computeFromRead(read: RegistrationReadResult, reader: RegistrationDocumentReader): Computed {
  const configuredGeo = reader.inferenceGeo ?? null;
  if (!read.ok) return failed(read.code, REGISTRATION_OCR_SOURCE, reader.engine, configuredGeo);
  // The engine only contributed detected text; the deterministic rules decide everything else.
  return fromParsed(buildRegistrationExtraction(read.candidates, { source: REGISTRATION_OCR_SOURCE }), { engine: reader.engine, reportedGeo: read.inferenceGeo ?? null, configuredGeo }, "OCR_UNREADABLE");
}

const AUDIT = (assetId: string, c: Computed) => ({
  actorType: "SYSTEM" as const,
  actorId: null,
  action: "vehicle.registration_extracted",
  entityType: "Vehicle",
  entityId: assetId,
  // Metadata ONLY — never extracted values, PII, object key, or text.
  newValue: {
    status: c.status,
    source: c.source,
    parserVersion: REGISTRATION_PARSER_VERSION,
    failureCode: c.failureCode ?? null,
    // An OCR reading is an AI-assisted suggestion (ADR-0008 §13/§15/§16): the record names the
    // engine, why it ran, where it ran, how much still needs human review, and the request it
    // belongs to.
    ...(c.source === REGISTRATION_OCR_SOURCE
      ? {
          // "AI-assisted" only when an engine was actually involved — a gate outcome that sent
          // nothing (consent pending, not configured) is recorded as such, not as a reading.
          aiAssisted: c.ocrEngine !== null,
          ocrEngine: c.ocrEngine,
          inferenceGeo: c.configuredInferenceGeo,
          observedInferenceGeo: c.ocrInferenceGeo,
          reason: "REGISTRATION_DOCUMENT_READING",
          confidence: c.success ? "SUGGESTION_REQUIRES_PROVIDER_REVIEW" : null,
          fieldsRead: c.fieldsRead,
          fieldsNeedingReview: c.fieldsNeedingReview,
          requestId: getRequestId() ?? null,
        }
      : {}),
  },
});

type DocRow = { id: string; objectKey: string; assetId: string; mimeType: string; providerId: string };

export async function runVehicleRegistrationExtraction(
  input: RunExtractionInput,
  deps: ExtractionServiceDeps = defaultDeps,
): Promise<RunExtractionResult> {
  const { db } = deps;

  const found = await db.assetDocument.findUnique({
    where: { id: input.assetDocumentId },
    select: { id: true, type: true, objectKey: true, mimeType: true, assetId: true, asset: { select: { assetType: true, providerId: true } } },
  });
  if (!found) return { ok: false, error: "DOCUMENT_NOT_FOUND" };
  if (found.type !== "VEHICLE_REGISTRATION") return { ok: false, error: "WRONG_DOCUMENT_TYPE" };
  if (found.asset.assetType !== "VEHICLE") return { ok: false, error: "NOT_A_VEHICLE" };
  if (!deps.isStorageConfigured()) return { ok: false, error: "STORAGE_NOT_CONFIGURED" };
  const doc: DocRow = { id: found.id, objectKey: found.objectKey, assetId: found.assetId, mimeType: found.mimeType, providerId: found.asset.providerId };

  let bytes: ArrayBuffer;
  try {
    bytes = await deps.downloadPrivateObject(doc.objectKey);
  } catch (error) {
    logger.error("registrationExtraction.download_failed", { assetDocumentId: doc.id, error: safeErrorCategory(error) });
    return { ok: false, error: "DOWNLOAD_FAILED" };
  }
  const documentSha256 = sha256Hex(bytes);

  // Idempotency fast path: an existing SUCCESS for this exact document hash + parser version is a
  // no-op (no parse, no OCR call). A live PROCESSING row for the same bytes means another attempt
  // is reading it right now — do nothing and say so. A FAILED row, an expired lease, or a changed
  // hash/version falls through.
  const pre = await db.vehicleRegistrationExtraction.findUnique({
    where: { assetDocumentId: doc.id },
    select: { id: true, documentSha256: true, parserVersion: true, status: true, failureCode: true, processingExpiresAt: true },
  });
  if (pre && pre.documentSha256 === documentSha256 && pre.parserVersion === REGISTRATION_PARSER_VERSION) {
    if (pre.status === "PROCESSING") {
      if (isExtractionInProgress(pre)) return { ok: true, extractionId: pre.id, status: "PROCESSING", failureCode: null, idempotent: true };
    } else if (pre.status !== "FAILED") {
      return { ok: true, extractionId: pre.id, status: pre.status, failureCode: pre.failureCode, idempotent: true };
    }
  }

  const persistSafely = async (computed: Computed): Promise<RunExtractionResult> => {
    try {
      return await persist(deps, doc, documentSha256, computed);
    } catch (error) {
      logger.error("registrationExtraction.persist_failed", { assetDocumentId: doc.id, error: safeErrorCategory(error) });
      return { ok: false, error: "UNKNOWN_ERROR" };
    }
  };

  // ── Tier 1: native PDF text, always first. The parser is given a COPY (the PDF engine detaches
  //    the buffer it receives) because a scanned PDF still needs its bytes for OCR.
  const isPdf = doc.mimeType === "application/pdf";
  if (isPdf) {
    const pdfResult = await deps.extractPdfText(bytes.slice(0));
    if (pdfResult.ok || pdfResult.code !== "NO_TEXT_LAYER") return persistSafely(computeFromPdf(pdfResult));
  }

  // ── Tier 2: OCR, for a photo or an image-only PDF.
  if (!isRegistrationReadableMimeType(doc.mimeType)) return persistSafely(failed("INVALID_FILE_TYPE", REGISTRATION_EXTRACTION_SOURCE, null));
  const reader = deps.getReader();
  const policy = deps.getPolicy();
  if (!reader || !policy) {
    // No engine (or no processing notice) configured: the document stays stored and goes to manual
    // review. Honest codes — a scanned PDF keeps its long-standing NO_TEXT_LAYER, a photo says OCR
    // is not available.
    return persistSafely(isPdf ? failed("NO_TEXT_LAYER", REGISTRATION_EXTRACTION_SOURCE, null) : failed("OCR_NOT_CONFIGURED", REGISTRATION_OCR_SOURCE, null));
  }

  // CONSENT — the provider's recorded, current decision for THIS document AND these exact bytes
  // (a replaced document needs a fresh decision). A lookup failure is treated as "not granted"
  // (fail closed): nothing is sent, the provider is asked.
  let consent: EffectiveOcrConsent;
  try {
    consent = await deps.readConsent(db, { providerId: doc.providerId, assetDocumentId: doc.id, documentSha256 }, policy);
  } catch (error) {
    logger.error("registrationExtraction.consent_lookup_failed", { assetDocumentId: doc.id, error: safeErrorCategory(error) });
    consent = { state: "NONE", policyVersion: null, decidedAt: null };
  }
  if (!isOcrConsentGranted(consent)) return persistSafely(failed("OCR_CONSENT_REQUIRED", REGISTRATION_OCR_SOURCE, null));

  // Identical bytes already read for THIS provider by the same engine → reuse, no external call.
  let reusable: Computed | null = null;
  try {
    reusable = await findReusableOcrResult(db, doc, documentSha256, reader.engine);
  } catch (error) {
    logger.error("registrationExtraction.reuse_lookup_failed", { assetDocumentId: doc.id, error: safeErrorCategory(error) });
  }
  if (reusable) return persistSafely(reusable);

  let claim: OcrClaim;
  try {
    claim = await claimOcr(db, doc, documentSha256, reader.engine);
  } catch (error) {
    logger.error("registrationExtraction.claim_failed", { assetDocumentId: doc.id, error: safeErrorCategory(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
  if (claim.kind === "GONE") return { ok: false, error: "DOCUMENT_NOT_FOUND" };
  if (claim.kind === "SETTLED") return { ok: true, extractionId: claim.id, status: claim.status, failureCode: claim.failureCode, idempotent: true };
  if (claim.kind === "CAPPED") return persistSafely(failed("OCR_ATTEMPT_LIMIT", REGISTRATION_OCR_SOURCE, reader.engine, reader.inferenceGeo ?? null));

  // CALL BUDGET — consumed only by the attempt that holds the lease (a duplicate request never
  // spends a unit). Denied → the lease is completed as a retryable failure; no call is made.
  let budget: "ALLOWED" | "LIMITED";
  try {
    budget = await deps.consumeOcrBudget({ providerId: doc.providerId, userId: input.actorUserId ?? null });
  } catch {
    budget = "LIMITED"; // fail closed
  }
  if (budget !== "ALLOWED") return completeOcr(db, doc, claim, failed("OCR_RATE_LIMITED", REGISTRATION_OCR_SOURCE, reader.engine, reader.inferenceGeo ?? null));

  // The ONE external call for this document. The reader never throws by contract; treat a throw as
  // a provider error anyway so a bug there can never leave the row stuck or leak a message.
  let read: RegistrationReadResult;
  try {
    read = await reader.read({ bytes, mimeType: doc.mimeType });
  } catch {
    read = { ok: false, code: "OCR_PROVIDER_ERROR" };
  }

  return completeOcr(db, doc, claim, computeFromRead(read, reader));
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

/** Columns written for a final (non-PROCESSING) outcome. Always clears the processing lease. */
function finalColumns(documentSha256: string, computed: Computed, now: Date) {
  return {
    documentSha256,
    parserVersion: REGISTRATION_PARSER_VERSION,
    source: computed.source,
    ocrEngine: computed.ocrEngine,
    ocrInferenceGeo: computed.ocrInferenceGeo,
    status: computed.status,
    failureCode: computed.failureCode,
    ...computed.typed,
    fields: computed.fields,
    warnings: computed.warnings,
    processedAt: now,
    lastAttemptedAt: now,
    processingToken: null,
    processingExpiresAt: null,
  };
}

async function persist(deps: ExtractionServiceDeps, doc: DocRow, documentSha256: string, computed: Computed): Promise<RunExtractionResult> {
  const { db } = deps;
  for (let attempt = 0; attempt < MAX_PERSIST_ATTEMPTS; attempt++) {
    const current = await db.vehicleRegistrationExtraction.findUnique({
      where: { assetDocumentId: doc.id },
      select: { id: true, documentSha256: true, parserVersion: true, status: true, failureCode: true, version: true, lastSucceededAt: true, attemptCount: true, processingExpiresAt: true },
    });

    const now = new Date();

    if (!current) {
      try {
        const row = await db.$transaction(async (tx) => {
          const created = await tx.vehicleRegistrationExtraction.create({
            data: { assetId: doc.assetId, assetDocumentId: doc.id, ...finalColumns(documentSha256, computed, now), attemptCount: 1, lastSucceededAt: computed.success ? now : null },
            select: { id: true, status: true, failureCode: true },
          });
          await recordAuditEvent(AUDIT(doc.assetId, computed), tx);
          return created;
        });
        return { ok: true, extractionId: row.id, status: row.status, failureCode: row.failureCode, idempotent: false };
      } catch (error) {
        if (isUniqueViolation(error)) continue; // a concurrent create won — re-read next iteration
        if (isForeignKeyViolation(error)) return { ok: false, error: "DOCUMENT_NOT_FOUND" }; // cancelled meanwhile — write nothing
        throw error;
      }
    }

    const sameHashVersion = current.documentSha256 === documentSha256 && current.parserVersion === REGISTRATION_PARSER_VERSION;

    // Another attempt is reading these very bytes right now — never write over it.
    if (sameHashVersion && isExtractionInProgress(current, now)) {
      return { ok: true, extractionId: current.id, status: "PROCESSING", failureCode: null, idempotent: true };
    }

    // Idempotent: an existing non-FAILED success for this exact hash+version is authoritative —
    // never re-write (deterministic content) and never DOWNGRADE it with a transient failure.
    if (sameHashVersion && current.status !== "FAILED" && current.status !== "PROCESSING") {
      return { ok: true, extractionId: current.id, status: current.status, failureCode: current.failureCode, idempotent: true };
    }

    // Reprocess/retry: guarded CAS on (id, version). A concurrent writer that bumped the version
    // makes count=0 → re-read and re-decide (never a lost update, never a failure over a success).
    const row = await db.$transaction(async (tx) => {
      const upd = await tx.vehicleRegistrationExtraction.updateMany({
        where: { id: current.id, version: current.version },
        data: {
          ...finalColumns(documentSha256, computed, now),
          attemptCount: current.attemptCount + 1,
          lastSucceededAt: computed.success ? now : current.lastSucceededAt,
          version: current.version + 1,
        },
      });
      if (upd.count === 0) return null; // raced — retry
      await recordAuditEvent(AUDIT(doc.assetId, computed), tx);
      return { id: current.id };
    });
    if (!row) continue;
    return { ok: true, extractionId: current.id, status: computed.status, failureCode: computed.failureCode, idempotent: false };
  }

  // Exhausted retries under heavy contention — return the current authoritative row if present.
  const final = await db.vehicleRegistrationExtraction.findUnique({
    where: { assetDocumentId: doc.id },
    select: { id: true, status: true, failureCode: true },
  });
  return final
    ? { ok: true, extractionId: final.id, status: final.status, failureCode: final.failureCode, idempotent: true }
    : { ok: false, error: "UNKNOWN_ERROR" };
}

/**
 * An OCR result already produced for IDENTICAL bytes (same server-computed SHA-256), by the same
 * engine and parser, for a document of the SAME provider — e.g. the provider uploaded the same
 * file under another onboarding request. Reused instead of calling the engine again. Never crosses
 * providers: one provider's upload can neither read nor be influenced by another's.
 */
async function findReusableOcrResult(db: PrismaClient, doc: DocRow, documentSha256: string, engine: string): Promise<Computed | null> {
  const hit = await db.vehicleRegistrationExtraction.findFirst({
    where: {
      documentSha256,
      parserVersion: REGISTRATION_PARSER_VERSION,
      source: REGISTRATION_OCR_SOURCE,
      ocrEngine: engine,
      status: { in: ["EXTRACTED", "NEEDS_REVIEW"] },
      assetDocumentId: { not: doc.id },
      asset: { providerId: doc.providerId },
    },
    orderBy: { lastSucceededAt: "desc" },
    select: { status: true, fields: true, warnings: true, ocrInferenceGeo: true, extractedVin: true, extractedPlateNumber: true, extractedLicensedPassengerCapacity: true, extractedManufactureYear: true, licenseExpiryDate: true },
  });
  if (!hit || hit.status === "FAILED" || hit.status === "PROCESSING") return null;
  const parsed = persistedFieldsSchema.safeParse(hit.fields);
  if (!parsed.success) return null; // never copy a blob that does not match the strict allowlisted shape
  const all = Object.values(parsed.data) as { normalizedValue: string | number | null; confidence: string }[];
  const priorWarnings = Array.isArray(hit.warnings) ? hit.warnings.filter((w): w is string => typeof w === "string") : [];
  return {
    status: hit.status,
    failureCode: null,
    fields: parsed.data as Prisma.InputJsonObject,
    warnings: Array.from(new Set([...priorWarnings, "REUSED_IDENTICAL_DOCUMENT"])),
    typed: {
      extractedVin: hit.extractedVin,
      extractedPlateNumber: hit.extractedPlateNumber,
      extractedLicensedPassengerCapacity: hit.extractedLicensedPassengerCapacity,
      extractedManufactureYear: hit.extractedManufactureYear,
      licenseExpiryDate: hit.licenseExpiryDate,
    },
    success: true,
    source: REGISTRATION_OCR_SOURCE,
    ocrEngine: engine,
    ocrInferenceGeo: hit.ocrInferenceGeo ?? null,
    configuredInferenceGeo: null,
    fieldsRead: all.filter((f) => f.normalizedValue !== null).length,
    fieldsNeedingReview: all.filter((f) => f.normalizedValue !== null && f.confidence !== "HIGH").length,
  };
}

type OcrClaim =
  | { kind: "CLAIMED"; id: string; token: string }
  /** Another attempt holds the lease, or a result already exists — do no work. */
  | { kind: "SETTLED"; id: string; status: RegistrationRecordStatus; failureCode: string | null }
  /** This document has reached its ceiling of external calls — no further call, manual entry. */
  | { kind: "CAPPED" }
  /** The document no longer exists (the setup was cancelled). */
  | { kind: "GONE" };

/**
 * Take the PROCESSING lease for this document's bytes — the gate in front of the external call.
 * Exactly one attempt wins (unique document row on create, version CAS on takeover). Taking the
 * lease counts as one external-call attempt against the per-document ceiling.
 */
async function claimOcr(db: PrismaClient, doc: DocRow, documentSha256: string, engine: string): Promise<OcrClaim> {
  for (let attempt = 0; attempt < MAX_PERSIST_ATTEMPTS + 2; attempt++) {
    const now = new Date();
    const token = randomUUID();
    const lease = {
      documentSha256,
      parserVersion: REGISTRATION_PARSER_VERSION,
      source: REGISTRATION_OCR_SOURCE,
      ocrEngine: engine,
      ocrInferenceGeo: null,
      status: "PROCESSING" as const,
      failureCode: null,
      // A row being read shows no stale suggestion (e.g. from a replaced document).
      ...NO_TYPED,
      fields: Prisma.JsonNull,
      warnings: Prisma.JsonNull,
      lastAttemptedAt: now,
      processingToken: token,
      processingExpiresAt: new Date(now.getTime() + REGISTRATION_OCR_LEASE_MS),
    };

    const current = await db.vehicleRegistrationExtraction.findUnique({
      where: { assetDocumentId: doc.id },
      select: { id: true, documentSha256: true, parserVersion: true, status: true, failureCode: true, version: true, attemptCount: true, processingExpiresAt: true, ocrCallCount: true },
    });

    if (!current) {
      try {
        const created = await db.vehicleRegistrationExtraction.create({
          data: { assetId: doc.assetId, assetDocumentId: doc.id, ...lease, attemptCount: 1, ocrCallCount: 1 },
          select: { id: true },
        });
        return { kind: "CLAIMED", id: created.id, token };
      } catch (error) {
        if (isUniqueViolation(error)) continue; // a concurrent attempt created it — re-read
        if (isForeignKeyViolation(error)) return { kind: "GONE" }; // the document was deleted (cancel)
        throw error;
      }
    }

    const sameHashVersion = current.documentSha256 === documentSha256 && current.parserVersion === REGISTRATION_PARSER_VERSION;
    if (sameHashVersion) {
      if (isExtractionInProgress(current, now)) return { kind: "SETTLED", id: current.id, status: "PROCESSING", failureCode: null };
      if (current.status === "EXTRACTED" || current.status === "NEEDS_REVIEW") return { kind: "SETTLED", id: current.id, status: current.status, failureCode: current.failureCode };
    }

    // The per-document ceiling: once this many external-call attempts were started for the
    // document, no further call is ever made for it (pre-gate rows have NULL = 0).
    const callsSoFar = current.ocrCallCount ?? 0;
    if (callsSoFar >= MAX_OCR_CALLS_PER_DOCUMENT) return { kind: "CAPPED" };

    // FAILED (retry), an expired lease (the attempt died), or different bytes (the document was
    // replaced) → take the row over. The version CAS lets exactly one taker win; any attempt still
    // holding the old lease can no longer complete (its token is gone).
    const taken = await db.vehicleRegistrationExtraction.updateMany({
      where: { id: current.id, version: current.version },
      data: { ...lease, attemptCount: current.attemptCount + 1, ocrCallCount: callsSoFar + 1, version: current.version + 1 },
    });
    if (taken.count === 1) return { kind: "CLAIMED", id: current.id, token };
  }
  // Could not settle under contention — report what is there now without doing any work.
  const final = await db.vehicleRegistrationExtraction.findUnique({ where: { assetDocumentId: doc.id }, select: { id: true, status: true, failureCode: true } });
  return final ? { kind: "SETTLED", id: final.id, status: final.status, failureCode: final.failureCode } : { kind: "GONE" };
}

/**
 * Write the outcome of the OCR call — ONLY if this attempt still holds the lease. The guarded
 * update and the audit share one transaction.
 */
async function completeOcr(db: PrismaClient, doc: DocRow, claim: { id: string; token: string }, computed: Computed): Promise<RunExtractionResult> {
  const stillMine = { id: claim.id, status: "PROCESSING" as const, processingToken: claim.token };
  try {
    const written = await db.$transaction(async (tx) => {
      const now = new Date();
      const upd = await tx.vehicleRegistrationExtraction.updateMany({
        where: stillMine,
        data: {
          source: computed.source,
          ocrEngine: computed.ocrEngine,
          ocrInferenceGeo: computed.ocrInferenceGeo,
          status: computed.status,
          failureCode: computed.failureCode,
          ...computed.typed,
          fields: computed.fields,
          warnings: computed.warnings,
          processedAt: now,
          ...(computed.success ? { lastSucceededAt: now } : {}),
          processingToken: null,
          processingExpiresAt: null,
          version: { increment: 1 },
        },
      });
      if (upd.count === 0) return false; // lease lost — the answer arrived too late
      await recordAuditEvent(AUDIT(doc.assetId, computed), tx);
      return true;
    });
    if (written) return { ok: true, extractionId: claim.id, status: computed.status, failureCode: computed.failureCode, idempotent: false };
  } catch (error) {
    // The audit or the database failed: NOTHING was marked complete. Hand the lease back as a
    // retryable failure; if even that cannot be written, the lease simply expires.
    await db.vehicleRegistrationExtraction
      .updateMany({ where: stillMine, data: { status: "FAILED", failureCode: "EXTRACTION_FAILED", processingToken: null, processingExpiresAt: null, version: { increment: 1 } } })
      .catch(() => {});
    logger.error("registrationExtraction.ocr_complete_failed", { assetDocumentId: doc.id, error: safeErrorCategory(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }

  // DISCARDED. The setup was cancelled (row deleted with the document), the document was replaced,
  // or the lease expired and another attempt took over. The late answer is dropped — nothing is
  // created, nothing is audited — and the caller is told what exists now.
  const current = await db.vehicleRegistrationExtraction
    .findUnique({ where: { id: claim.id }, select: { id: true, status: true, failureCode: true } })
    .catch(() => null);
  return current
    ? { ok: true, extractionId: current.id, status: current.status, failureCode: current.failureCode, idempotent: true }
    : { ok: false, error: "DOCUMENT_NOT_FOUND" };
}
