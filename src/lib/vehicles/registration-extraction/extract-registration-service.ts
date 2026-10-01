import "server-only";
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { isDocumentStorageConfigured, downloadPrivateObject } from "@/lib/storage/storage";
import { REGISTRATION_PARSER_VERSION, REGISTRATION_EXTRACTION_SOURCE } from "./constants";
import { parseOmanVehicleRegistration } from "./parse-registration";
import { extractPdfText, type PdfTextResult } from "./pdf-text";
import { serializePersistedFields, serializeWarnings, extractionTypedColumns } from "./record";
import type { RegistrationExtractionStatus } from "./codes";

// Phase 3C — Vehicle Registration Extraction, Slice 2 (hardened in the Slice-2 correction).
// Server-only orchestration turning an already-authorized VEHICLE_REGISTRATION document into a
// PRIVATE extraction CANDIDATE. It NEVER mutates the Vehicle, NEVER exposes a route/action/cron/
// UI, and NEVER trusts a client-supplied provider identity (its ONLY input is a document id).
//
// STATE MACHINE (one row per document; update-in-place, NOT immutable versions):
//   existing EXTRACTED/NEEDS_REVIEW + same hash & parser version → idempotent no-op (no re-parse,
//     no duplicate audit);
//   existing FAILED (same hash & version) → RETRYABLE (re-parse; never permanently stuck);
//   parser version changed OR document hash changed → reprocess (a replaced document re-extracts).
//
// CONCURRENCY: a fresh-read + create-or-guarded-update loop (bounded retry). The unique
// (assetDocumentId) index + a version CAS are the arbiters: a concurrent create P2002 is caught
// and resolved by re-reading; a guarded updateMany on (id, version) prevents lost updates and
// stops a transient FAILURE from overwriting a concurrent SUCCESS. Persist + audit share ONE
// transaction (audit failure rolls back); a success audit is emitted at most once.

export type RunExtractionInput = { assetDocumentId: string };

export type RunExtractionResult =
  | { ok: true; extractionId: string; status: RegistrationExtractionStatus; failureCode: string | null; idempotent: boolean }
  | { ok: false; error: "DOCUMENT_NOT_FOUND" | "WRONG_DOCUMENT_TYPE" | "NOT_A_VEHICLE" | "STORAGE_NOT_CONFIGURED" | "DOWNLOAD_FAILED" | "UNKNOWN_ERROR" };

// Injectable seams (tests / disposable-DB proofs). Defaults use the real adapter, storage, and
// the global prisma client.
export type ExtractionServiceDeps = {
  db: PrismaClient;
  extractPdfText: (bytes: ArrayBuffer) => Promise<PdfTextResult>;
  downloadPrivateObject: (objectKey: string) => Promise<ArrayBuffer>;
  isStorageConfigured: () => boolean;
};

const defaultDeps: ExtractionServiceDeps = {
  db: prisma,
  extractPdfText: (bytes) => extractPdfText(bytes),
  downloadPrivateObject,
  isStorageConfigured: isDocumentStorageConfigured,
};

const MAX_PERSIST_ATTEMPTS = 3;

function sha256Hex(bytes: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

type Computed = {
  status: RegistrationExtractionStatus;
  failureCode: string | null;
  fields: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  warnings: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  typed: {
    extractedVin: string | null;
    extractedPlateNumber: string | null;
    extractedLicensedPassengerCapacity: number | null;
    extractedManufactureYear: number | null;
    licenseExpiryDate: string | null;
  };
  success: boolean;
};

function compute(pdfResult: PdfTextResult): Computed {
  if (!pdfResult.ok) {
    return {
      status: "FAILED",
      failureCode: pdfResult.code,
      fields: Prisma.JsonNull,
      warnings: Prisma.JsonNull,
      typed: { extractedVin: null, extractedPlateNumber: null, extractedLicensedPassengerCapacity: null, extractedManufactureYear: null, licenseExpiryDate: null },
      success: false,
    };
  }
  const parsed = parseOmanVehicleRegistration(pdfResult.text);
  return {
    status: parsed.overallStatus,
    failureCode: parsed.overallStatus === "FAILED" ? "UNSUPPORTED_LAYOUT" : null,
    fields: serializePersistedFields(parsed),
    warnings: serializeWarnings(parsed),
    typed: extractionTypedColumns(parsed),
    // A parse that produced no usable fields is NOT a success (it's FAILED/UNSUPPORTED_LAYOUT).
    success: parsed.overallStatus !== "FAILED",
  };
}

const AUDIT = (assetId: string, c: Computed) => ({
  actorType: "SYSTEM" as const,
  actorId: null,
  action: "vehicle.registration_extracted",
  entityType: "Vehicle",
  entityId: assetId,
  // Metadata ONLY — never extracted values, PII, object key, or text.
  newValue: { status: c.status, source: REGISTRATION_EXTRACTION_SOURCE, parserVersion: REGISTRATION_PARSER_VERSION, failureCode: c.failureCode ?? null },
});

export async function runVehicleRegistrationExtraction(
  input: RunExtractionInput,
  deps: ExtractionServiceDeps = defaultDeps,
): Promise<RunExtractionResult> {
  const { db } = deps;

  const doc = await db.assetDocument.findUnique({
    where: { id: input.assetDocumentId },
    select: { id: true, type: true, objectKey: true, assetId: true, asset: { select: { assetType: true } } },
  });
  if (!doc) return { ok: false, error: "DOCUMENT_NOT_FOUND" };
  if (doc.type !== "VEHICLE_REGISTRATION") return { ok: false, error: "WRONG_DOCUMENT_TYPE" };
  if (doc.asset.assetType !== "VEHICLE") return { ok: false, error: "NOT_A_VEHICLE" };
  if (!deps.isStorageConfigured()) return { ok: false, error: "STORAGE_NOT_CONFIGURED" };

  let bytes: ArrayBuffer;
  try {
    bytes = await deps.downloadPrivateObject(doc.objectKey);
  } catch (error) {
    logger.error("registrationExtraction.download_failed", { assetDocumentId: doc.id, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "DOWNLOAD_FAILED" };
  }
  const documentSha256 = sha256Hex(bytes);

  // Pre-parse idempotency fast path: an existing SUCCESS for this exact document hash + parser
  // version is a no-op (skip the expensive parse). A FAILED row (same hash) falls through and is
  // re-attempted; a changed hash/version falls through and reprocesses.
  const pre = await db.vehicleRegistrationExtraction.findUnique({
    where: { assetDocumentId: doc.id },
    select: { id: true, documentSha256: true, parserVersion: true, status: true, failureCode: true },
  });
  if (pre && pre.documentSha256 === documentSha256 && pre.parserVersion === REGISTRATION_PARSER_VERSION && pre.status !== "FAILED") {
    return { ok: true, extractionId: pre.id, status: pre.status, failureCode: pre.failureCode, idempotent: true };
  }

  const pdfResult = await deps.extractPdfText(bytes);
  const computed = compute(pdfResult);

  try {
    return await persist(deps, doc.id, doc.assetId, documentSha256, computed);
  } catch (error) {
    logger.error("registrationExtraction.persist_failed", { assetDocumentId: doc.id, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function persist(
  deps: ExtractionServiceDeps,
  assetDocumentId: string,
  assetId: string,
  documentSha256: string,
  computed: Computed,
): Promise<RunExtractionResult> {
  const { db } = deps;
  for (let attempt = 0; attempt < MAX_PERSIST_ATTEMPTS; attempt++) {
    const current = await db.vehicleRegistrationExtraction.findUnique({
      where: { assetDocumentId },
      select: { id: true, documentSha256: true, parserVersion: true, status: true, failureCode: true, version: true, lastSucceededAt: true, attemptCount: true },
    });

    const now = new Date();

    if (!current) {
      try {
        const row = await db.$transaction(async (tx) => {
          const created = await tx.vehicleRegistrationExtraction.create({
            data: {
              assetId,
              assetDocumentId,
              documentSha256,
              parserVersion: REGISTRATION_PARSER_VERSION,
              source: REGISTRATION_EXTRACTION_SOURCE,
              status: computed.status,
              failureCode: computed.failureCode,
              ...computed.typed,
              fields: computed.fields,
              warnings: computed.warnings,
              processedAt: now,
              attemptCount: 1,
              lastAttemptedAt: now,
              lastSucceededAt: computed.success ? now : null,
            },
            select: { id: true, status: true, failureCode: true },
          });
          await recordAuditEvent(AUDIT(assetId, computed), tx);
          return created;
        });
        return { ok: true, extractionId: row.id, status: row.status, failureCode: row.failureCode, idempotent: false };
      } catch (error) {
        if (isUniqueViolation(error)) continue; // a concurrent create won — re-read next iteration
        throw error;
      }
    }

    const sameHashVersion = current.documentSha256 === documentSha256 && current.parserVersion === REGISTRATION_PARSER_VERSION;

    // Idempotent: an existing non-FAILED success for this exact hash+version is authoritative —
    // never re-write (deterministic content) and never DOWNGRADE it with a transient failure.
    if (sameHashVersion && current.status !== "FAILED") {
      return { ok: true, extractionId: current.id, status: current.status, failureCode: current.failureCode, idempotent: true };
    }

    // Reprocess/retry: guarded CAS on (id, version). A concurrent writer that bumped the version
    // makes count=0 → re-read and re-decide (never a lost update, never a failure over a success).
    const row = await db.$transaction(async (tx) => {
      const upd = await tx.vehicleRegistrationExtraction.updateMany({
        where: { id: current.id, version: current.version },
        data: {
          documentSha256,
          parserVersion: REGISTRATION_PARSER_VERSION,
          source: REGISTRATION_EXTRACTION_SOURCE,
          status: computed.status,
          failureCode: computed.failureCode,
          ...computed.typed,
          fields: computed.fields,
          warnings: computed.warnings,
          processedAt: now,
          attemptCount: current.attemptCount + 1,
          lastAttemptedAt: now,
          lastSucceededAt: computed.success ? now : current.lastSucceededAt,
          version: current.version + 1,
        },
      });
      if (upd.count === 0) return null; // raced — retry
      await recordAuditEvent(AUDIT(assetId, computed), tx);
      return { id: current.id };
    });
    if (!row) continue;
    return { ok: true, extractionId: current.id, status: computed.status, failureCode: computed.failureCode, idempotent: false };
  }

  // Exhausted retries under heavy contention — return the current authoritative row if present.
  const final = await db.vehicleRegistrationExtraction.findUnique({
    where: { assetDocumentId },
    select: { id: true, status: true, failureCode: true },
  });
  return final
    ? { ok: true, extractionId: final.id, status: final.status, failureCode: final.failureCode, idempotent: true }
    : { ok: false, error: "UNKNOWN_ERROR" };
}
