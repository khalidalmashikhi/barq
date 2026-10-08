import "server-only";
import { randomUUID } from "node:crypto";
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
  MAX_OCR_INPUT_BYTES,
  type RegistrationExtractionSource,
} from "./constants";
import { parseOmanVehicleRegistration, buildRegistrationExtraction, isNativeTextUsable } from "./parse-registration";
import { extractPdfText, type PdfTextResult } from "./pdf-text";
import { serializePersistedFields, serializeWarnings, extractionTypedColumns, persistedFieldsSchema, type ExtractionTypedColumns } from "./record";
import { isExtractionInProgress } from "./processing-lease";
import {
  REGISTRATION_FRONT_TYPE,
  REGISTRATION_SET_TYPES,
  checkRegistrationSetShape,
  computeRegistrationSetHash,
  roleOfRegistrationType,
  sha256Hex,
  type RegistrationPageRole,
} from "./registration-document-set";
import { getRegistrationDocumentReader, getRegistrationOcrPolicy, type RegistrationOcrPolicy } from "./ocr/get-registration-document-reader";
import { getEffectiveOcrConsent, isOcrConsentGranted, type EffectiveOcrConsent } from "./ocr/ocr-consent";
import { isRegistrationReadableMimeType, type RegistrationDocumentReader, type RegistrationReadPage, type RegistrationReadResult } from "./ocr/registration-document-reader";
import type { RegistrationExtractionStatus, RegistrationRecordStatus } from "./codes";
import type { VehicleRegistrationExtractionResult } from "./types";

// Phase 3C — Vehicle Registration Extraction. Server-only orchestration turning an
// already-authorized VEHICLE_REGISTRATION document SET into a PRIVATE extraction CANDIDATE. It
// NEVER mutates the Vehicle, NEVER exposes a route/action/cron/UI, and NEVER trusts a
// client-supplied provider identity (its ONLY input is the front document's id, plus — optionally
// — the acting user's id for the OCR call budget).
//
// THE SET (registration-document-set.ts): the front/primary document (a PDF of one or two pages,
// or the front photo) and, for photos only, an optional back side — up to two AssetDocument rows
// of the same asset. The extraction row lives on the FRONT document; its `documentSha256` is the
// ORDERED SET HASH (one page → that page's hash, unchanged from before; two pages → a hash over the
// pair), so replacing, removing, adding or swapping either side changes the identity every
// downstream record is bound to: the stored extraction becomes stale, the consent "not granted",
// and OCR reuse misses. A partial set hashes differently from a complete one.
//
// TWO TIERS, IN THIS ORDER
//   1. NATIVE PDF TEXT — deterministic local extraction. Always tried first for a PDF; no external
//      call is ever made for a PDF whose text layer yields a USABLE reading (at least one critical
//      field). A PDF that is encrypted / malformed / over the page limit stops here.
//   2. OCR — for a photo, a two-photo set, an image-only PDF, OR a PDF whose text layer yielded
//      nothing usable (unsupported layout) — only when an OCR engine is configured, and ONLY with
//      the provider's recorded consent for THIS set. The engine reports the text it sees per
//      allowlisted field for the WHOLE set in ONE request; the SAME deterministic normalizers /
//      validators then build the result (a field printed differently on two sides is a CONFLICT the
//      provider resolves), capped so that an OCR value is always "needs review". With no engine
//      configured the set stays on the manual path (FAILED / OCR_NOT_CONFIGURED); with no consent it
//      waits for the provider's choice (FAILED / OCR_CONSENT_REQUIRED) — in both cases nothing is
//      sent anywhere and nothing is invented.
//
// THE GATES IN FRONT OF THE EXTERNAL CALL, in order — every one of them stops before any byte leaves:
//   • a readable, well-formed set (PDF alone, at most two pages, aggregate bytes within bound);
//   • engine AND processing notice configured (fail closed);
//   • CONSENT: the latest decision for (this front document, this provider) is GRANTED for the
//     current notice version, processor and EXACT SET HASH — never another provider's, another
//     set's or a stale one;
//   • REUSE: an identical set already read for this provider by this engine → no call at all;
//   • the per-document CEILING on external calls (MAX_OCR_CALLS_PER_DOCUMENT);
//   • the LEASE (exactly one attempt per document at a time);
//   • the durable, fail-closed CALL BUDGET per provider and per acting user (rate limit).
//   And after the call: the engine's REPORTED inference geography must equal the configured one —
//   otherwise the answer is discarded unread (OCR_GEO_MISMATCH); there is no fallback geography.
//
// STATE MACHINE (one row per front document; update-in-place, NOT immutable versions):
//   existing EXTRACTED/NEEDS_REVIEW + same set hash & parser version → idempotent no-op (no re-parse,
//     NO second OCR call, no duplicate audit) — this is what makes retry / reload / replay cheap;
//   existing FAILED (same hash & version) → RETRYABLE;
//   parser version changed OR set hash changed → reprocess (a replaced/added/removed side re-extracts);
//   PROCESSING → one attempt holds a LEASE while an OCR call is in flight. A second request for
//     the same set does no work and reports PROCESSING; an expired lease may be taken over.
//
// ONE EFFECTIVE OCR PER SET
//   • the lease guarantees at most one external call at a time per document;
//   • an OCR result is REUSED for an identical set already read for the SAME provider with the
//     same engine (matched by the server-computed set hash — never across providers);
//   • completion is a guarded update on the lease token, so a late answer for a set that was
//     cancelled (row deleted), changed or taken over is DISCARDED — it can never resurrect a
//     cancelled setup or overwrite a newer result;
//   • completion and its audit share ONE transaction: an audit or database failure leaves the row
//     NOT complete, and it is handed back as a retryable failure.
//
// Nothing here logs document bytes, OCR text, a plate, a VIN, a request or response body, or a
// provider error message — log context is a fixed set of ids and error CATEGORIES.

export type RunExtractionInput = {
  /** The FRONT (primary) registration document of the set. */
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
  /** The provider's effective decision for ONE set (never another provider's). */
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
  /** How many pages/sides the set had (audit record only). */
  pageCount: number;
  /** Document-level codes added by the service (e.g. why native text was not used). */
  extraWarnings: string[];
};

function failed(failureCode: string, source: RegistrationExtractionSource, ocrEngine: string | null, configuredInferenceGeo: string | null = null, pageCount = 1, extraWarnings: string[] = []): Computed {
  return { status: "FAILED", failureCode, fields: Prisma.JsonNull, warnings: extraWarnings.length > 0 ? extraWarnings : Prisma.JsonNull, typed: NO_TYPED, success: false, source, ocrEngine, ocrInferenceGeo: null, configuredInferenceGeo, fieldsRead: 0, fieldsNeedingReview: 0, pageCount, extraWarnings };
}

function fromParsed(parsed: VehicleRegistrationExtractionResult, ocr: { engine: string; reportedGeo: string | null; configuredGeo: string | null } | null, unreadableCode: string, pageCount: number, extraWarnings: string[] = []): Computed {
  // A parse that produced no usable field is NOT a success.
  if (parsed.overallStatus === "FAILED") return failed(unreadableCode, parsed.source, ocr?.engine ?? null, ocr?.configuredGeo ?? null, pageCount, extraWarnings);
  const all = Object.values(parsed.fields);
  const warnings = Array.from(new Set([...parsed.warnings, ...extraWarnings]));
  return {
    status: parsed.overallStatus,
    failureCode: null,
    fields: serializePersistedFields(parsed),
    warnings: warnings.length > 0 ? warnings : serializeWarnings(parsed),
    typed: extractionTypedColumns(parsed),
    success: true,
    source: parsed.source,
    ocrEngine: ocr?.engine ?? null,
    ocrInferenceGeo: ocr?.reportedGeo ?? null,
    configuredInferenceGeo: ocr?.configuredGeo ?? null,
    fieldsRead: all.filter((f) => f.normalizedValue !== null).length,
    fieldsNeedingReview: all.filter((f) => f.normalizedValue !== null && f.confidence !== "HIGH").length + all.filter((f) => f.warnings.includes("CONFLICT")).length,
    pageCount,
    extraWarnings,
  };
}

function computeFromRead(read: RegistrationReadResult, reader: RegistrationDocumentReader, pageCount: number, extraWarnings: string[]): Computed {
  const configuredGeo = reader.inferenceGeo ?? null;
  if (!read.ok) return failed(read.code, REGISTRATION_OCR_SOURCE, reader.engine, configuredGeo, pageCount, extraWarnings);
  // The engine only contributed detected text; the deterministic rules decide everything else.
  return fromParsed(buildRegistrationExtraction(read.candidates, { source: REGISTRATION_OCR_SOURCE }), { engine: reader.engine, reportedGeo: read.inferenceGeo ?? null, configuredGeo }, "OCR_UNREADABLE", pageCount, extraWarnings);
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
    pageCount: c.pageCount,
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

/** The front document the extraction row is attached to. */
type DocRow = { id: string; assetId: string; mimeType: string; providerId: string };

/** One ordered page of the set with its stored bytes. */
type LoadedPage = { role: RegistrationPageRole; documentId: string; mimeType: string; bytes: ArrayBuffer; sha256: string };

/**
 * Resolve the complete ordered set of an asset's registration documents (front first, optional
 * back) and download every page. Documents of other types are ignored; a lone back side (no front)
 * is not a set and the caller reports DOCUMENT_NOT_FOUND through the front lookup.
 */
async function loadRegistrationSet(deps: ExtractionServiceDeps, assetId: string): Promise<LoadedPage[]> {
  const docs = await deps.db.assetDocument.findMany({
    where: { assetId, type: { in: [...REGISTRATION_SET_TYPES] } },
    select: { id: true, type: true, objectKey: true, mimeType: true },
  });
  const ordered = REGISTRATION_SET_TYPES.map((type) => docs.find((d) => d.type === type)).filter((d): d is NonNullable<typeof d> => !!d);
  const pages: LoadedPage[] = [];
  for (const d of ordered) {
    const bytes = await deps.downloadPrivateObject(d.objectKey);
    pages.push({ role: roleOfRegistrationType(d.type)!, documentId: d.id, mimeType: d.mimeType, bytes, sha256: sha256Hex(bytes) });
  }
  return pages;
}

export async function runVehicleRegistrationExtraction(
  input: RunExtractionInput,
  deps: ExtractionServiceDeps = defaultDeps,
): Promise<RunExtractionResult> {
  const { db } = deps;

  const found = await db.assetDocument.findUnique({
    where: { id: input.assetDocumentId },
    select: { id: true, type: true, mimeType: true, assetId: true, asset: { select: { assetType: true, providerId: true } } },
  });
  if (!found) return { ok: false, error: "DOCUMENT_NOT_FOUND" };
  if (found.type !== REGISTRATION_FRONT_TYPE) return { ok: false, error: "WRONG_DOCUMENT_TYPE" };
  if (found.asset.assetType !== "VEHICLE") return { ok: false, error: "NOT_A_VEHICLE" };
  if (!deps.isStorageConfigured()) return { ok: false, error: "STORAGE_NOT_CONFIGURED" };
  const doc: DocRow = { id: found.id, assetId: found.assetId, mimeType: found.mimeType, providerId: found.asset.providerId };

  // The COMPLETE set is what gets read and hashed: a back side that exists but cannot be fetched
  // makes the whole reading fail (never a reading of the front alone presented as the set).
  let pages: LoadedPage[];
  try {
    pages = await loadRegistrationSet(deps, doc.assetId);
  } catch (error) {
    logger.error("registrationExtraction.download_failed", { assetDocumentId: doc.id, error: safeErrorCategory(error) });
    return { ok: false, error: "DOWNLOAD_FAILED" };
  }
  if (pages.length === 0 || pages[0]!.documentId !== doc.id) return { ok: false, error: "DOCUMENT_NOT_FOUND" }; // the front vanished meanwhile
  const documentSha256 = computeRegistrationSetHash(pages.map((p) => p.sha256));
  const pageCount = pages.length;

  // Idempotency fast path: an existing SUCCESS for this exact set hash + parser version is a
  // no-op (no parse, no OCR call). A live PROCESSING row for the same set means another attempt
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

  // The set's shape is a precondition of ANY reading (a PDF travels alone; at most two pages).
  const shapeProblem = checkRegistrationSetShape(pages);
  if (shapeProblem) return persistSafely(failed("INVALID_DOCUMENT_SET", REGISTRATION_EXTRACTION_SOURCE, null, null, pageCount));

  // ── Tier 1: native PDF text, always first. The parser is given a COPY (the PDF engine detaches
  //    the buffer it receives) because a scanned PDF still needs its bytes for OCR.
  const isPdf = pages[0]!.mimeType === "application/pdf";
  const ocrWarnings: string[] = [];
  if (isPdf) {
    const pdfResult = await deps.extractPdfText(pages[0]!.bytes.slice(0));
    if (!pdfResult.ok && pdfResult.code !== "NO_TEXT_LAYER") return persistSafely(failed(pdfResult.code, REGISTRATION_EXTRACTION_SOURCE, null, null, pageCount));
    if (pdfResult.ok) {
      const native = parseOmanVehicleRegistration(pdfResult.text);
      // A USABLE native reading is final: deterministic, local, zero external calls.
      if (isNativeTextUsable(native)) return persistSafely(fromParsed(native, null, "UNSUPPORTED_LAYOUT", pageCount));
      // A text layer that yields nothing usable (unsupported layout, garbled order, a cover page)
      // must not dead-end the provider: the PDF is offered to OCR exactly like a scan, with the
      // reason recorded as a document-level code (never the text).
      ocrWarnings.push("NATIVE_TEXT_UNUSABLE");
    } else {
      ocrWarnings.push("NO_TEXT_LAYER");
    }
  }

  // ── Tier 2: OCR, for photos (one or two), an image-only PDF, or a PDF whose text was unusable.
  if (!pages.every((p) => isRegistrationReadableMimeType(p.mimeType))) return persistSafely(failed("INVALID_FILE_TYPE", REGISTRATION_EXTRACTION_SOURCE, null, null, pageCount));
  const reader = deps.getReader();
  const policy = deps.getPolicy();
  if (!reader || !policy) {
    // No engine (or no processing notice) configured: the set stays stored and goes to manual
    // review. Honest codes — a PDF keeps its long-standing NO_TEXT_LAYER / UNSUPPORTED_LAYOUT
    // outcome, a photo says OCR is not available.
    if (isPdf) return persistSafely(failed(ocrWarnings.includes("NATIVE_TEXT_UNUSABLE") ? "UNSUPPORTED_LAYOUT" : "NO_TEXT_LAYER", REGISTRATION_EXTRACTION_SOURCE, null, null, pageCount));
    return persistSafely(failed("OCR_NOT_CONFIGURED", REGISTRATION_OCR_SOURCE, null, null, pageCount));
  }
  // The aggregate ceiling is checked BEFORE consent is even asked for: a set that can never be sent
  // is not something to consent to.
  const totalBytes = pages.reduce((sum, p) => sum + p.bytes.byteLength, 0);
  if (totalBytes > MAX_OCR_INPUT_BYTES) return persistSafely(failed("OCR_INPUT_TOO_LARGE", REGISTRATION_OCR_SOURCE, null, null, pageCount, ocrWarnings));

  // CONSENT — the provider's recorded, current decision for THIS set (front document + exact set
  // hash; a changed side needs a fresh decision). A lookup failure is treated as "not granted"
  // (fail closed): nothing is sent, the provider is asked.
  let consent: EffectiveOcrConsent;
  try {
    consent = await deps.readConsent(db, { providerId: doc.providerId, assetDocumentId: doc.id, documentSha256 }, policy);
  } catch (error) {
    logger.error("registrationExtraction.consent_lookup_failed", { assetDocumentId: doc.id, error: safeErrorCategory(error) });
    consent = { state: "NONE", policyVersion: null, decidedAt: null };
  }
  if (!isOcrConsentGranted(consent)) return persistSafely(failed("OCR_CONSENT_REQUIRED", REGISTRATION_OCR_SOURCE, null, null, pageCount, ocrWarnings));

  // An identical set already read for THIS provider by the same engine → reuse, no external call.
  let reusable: Computed | null = null;
  try {
    reusable = await findReusableOcrResult(db, doc, documentSha256, reader.engine, pageCount, ocrWarnings);
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
  if (claim.kind === "CAPPED") return persistSafely(failed("OCR_ATTEMPT_LIMIT", REGISTRATION_OCR_SOURCE, reader.engine, reader.inferenceGeo ?? null, pageCount, ocrWarnings));

  // CALL BUDGET — consumed only by the attempt that holds the lease (a duplicate request never
  // spends a unit). Denied → the lease is completed as a retryable failure; no call is made.
  let budget: "ALLOWED" | "LIMITED";
  try {
    budget = await deps.consumeOcrBudget({ providerId: doc.providerId, userId: input.actorUserId ?? null });
  } catch {
    budget = "LIMITED"; // fail closed
  }
  if (budget !== "ALLOWED") return completeOcr(db, doc, claim, failed("OCR_RATE_LIMITED", REGISTRATION_OCR_SOURCE, reader.engine, reader.inferenceGeo ?? null, pageCount, ocrWarnings));

  // The ONE external call for this set — every page in order, in one request. The reader never
  // throws by contract; treat a throw as a provider error anyway so a bug there can never leave the
  // row stuck or leak a message.
  const readPages: RegistrationReadPage[] = pages.map((p) => ({ role: p.role, bytes: p.bytes, mimeType: p.mimeType as RegistrationReadPage["mimeType"] }));
  let read: RegistrationReadResult;
  try {
    read = await reader.read({ pages: readPages });
  } catch {
    read = { ok: false, code: "OCR_PROVIDER_ERROR" };
  }

  return completeOcr(db, doc, claim, computeFromRead(read, reader, pageCount, ocrWarnings));
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

    // Another attempt is reading this very set right now — never write over it.
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
 * An OCR result already produced for an IDENTICAL set (same server-computed set hash), by the same
 * engine and parser, for a set of the SAME provider — e.g. the provider uploaded the same files
 * under another onboarding request. Reused instead of calling the engine again. Never crosses
 * providers: one provider's upload can neither read nor be influenced by another's.
 */
async function findReusableOcrResult(db: PrismaClient, doc: DocRow, documentSha256: string, engine: string, pageCount: number, extraWarnings: string[]): Promise<Computed | null> {
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
  const all = Object.values(parsed.data) as { normalizedValue: string | number | null; confidence: string; warnings: string[] }[];
  const priorWarnings = Array.isArray(hit.warnings) ? hit.warnings.filter((w): w is string => typeof w === "string") : [];
  return {
    status: hit.status,
    failureCode: null,
    fields: parsed.data as Prisma.InputJsonObject,
    warnings: Array.from(new Set([...priorWarnings, ...extraWarnings, "REUSED_IDENTICAL_DOCUMENT"])),
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
    fieldsNeedingReview: all.filter((f) => f.normalizedValue !== null && f.confidence !== "HIGH").length + all.filter((f) => f.warnings.includes("CONFLICT")).length,
    pageCount,
    extraWarnings,
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
 * Take the PROCESSING lease for this set — the gate in front of the external call. Exactly one
 * attempt wins (unique document row on create, version CAS on takeover). Taking the lease counts
 * as one external-call attempt against the per-document ceiling.
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
      // A row being read shows no stale suggestion (e.g. from a replaced side).
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

    // FAILED (retry), an expired lease (the attempt died), or a different set (a side was replaced,
    // added or removed) → take the row over. The version CAS lets exactly one taker win; any attempt
    // still holding the old lease can no longer complete (its token is gone).
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

  // DISCARDED. The setup was cancelled (row deleted with the document), the set changed, or the
  // lease expired and another attempt took over. The late answer is dropped — nothing is created,
  // nothing is audited — and the caller is told what exists now.
  const current = await db.vehicleRegistrationExtraction
    .findUnique({ where: { id: claim.id }, select: { id: true, status: true, failureCode: true } })
    .catch(() => null);
  return current
    ? { ok: true, extractionId: current.id, status: current.status, failureCode: current.failureCode, idempotent: true }
    : { ok: false, error: "DOCUMENT_NOT_FOUND" };
}
