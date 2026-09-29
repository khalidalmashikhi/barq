import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { isDocumentStorageConfigured, downloadPrivateObject } from "@/lib/storage/storage";
import { REGISTRATION_PARSER_VERSION, REGISTRATION_EXTRACTION_SOURCE } from "./constants";
import { parseOmanVehicleRegistration } from "./parse-registration";
import { extractPdfText, type PdfTextResult } from "./pdf-text";
import { serializePersistedFields, serializeWarnings, extractionTypedColumns } from "./record";
import type { RegistrationExtractionStatus } from "./codes";

// Phase 3C — Vehicle Registration Extraction, Slice 2. The server-only orchestration that
// turns an already-authorized VEHICLE_REGISTRATION document into a PRIVATE extraction
// candidate. It NEVER mutates the Vehicle, NEVER exposes a route/action/cron/UI, and NEVER
// trusts a client-supplied provider identity (its ONLY input is a document id). Provider
// confirmation + admin verification are LATER slices.

export type RunExtractionInput = { assetDocumentId: string };

export type RunExtractionResult =
  | { ok: true; extractionId: string; status: RegistrationExtractionStatus; failureCode: string | null; idempotent: boolean }
  | { ok: false; error: "DOCUMENT_NOT_FOUND" | "WRONG_DOCUMENT_TYPE" | "NOT_A_VEHICLE" | "STORAGE_NOT_CONFIGURED" | "DOWNLOAD_FAILED" | "UNKNOWN_ERROR" };

// Injectable seams (tests). Defaults use the real adapter + real storage download.
export type ExtractionServiceDeps = {
  extractPdfText: (bytes: ArrayBuffer) => Promise<PdfTextResult>;
  downloadPrivateObject: (objectKey: string) => Promise<ArrayBuffer>;
};

const defaultDeps: ExtractionServiceDeps = {
  extractPdfText: (bytes) => extractPdfText(bytes),
  downloadPrivateObject,
};

function sha256Hex(bytes: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

export async function runVehicleRegistrationExtraction(
  input: RunExtractionInput,
  deps: ExtractionServiceDeps = defaultDeps,
): Promise<RunExtractionResult> {
  // 1) Load the document + its base asset. type + relationship are verified server-side;
  //    provider identity is NOT a parameter and is never trusted from any caller.
  const doc = await prisma.assetDocument.findUnique({
    where: { id: input.assetDocumentId },
    select: {
      id: true,
      type: true,
      objectKey: true,
      assetId: true,
      asset: { select: { assetType: true } },
    },
  });
  if (!doc) return { ok: false, error: "DOCUMENT_NOT_FOUND" };
  if (doc.type !== "VEHICLE_REGISTRATION") return { ok: false, error: "WRONG_DOCUMENT_TYPE" };
  if (doc.asset.assetType !== "VEHICLE") return { ok: false, error: "NOT_A_VEHICLE" };

  if (!isDocumentStorageConfigured()) return { ok: false, error: "STORAGE_NOT_CONFIGURED" };

  // 2) Fetch bytes server-side (never leaves the server) + hash for idempotency/provenance.
  let bytes: ArrayBuffer;
  try {
    bytes = await deps.downloadPrivateObject(doc.objectKey);
  } catch (error) {
    logger.error("registrationExtraction.download_failed", {
      assetDocumentId: doc.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "DOWNLOAD_FAILED" };
  }
  const documentSha256 = sha256Hex(bytes);

  // 3) Idempotency: an existing extraction for the same document hash + parser version is a
  //    no-op (no rewrite, no audit) — a stable historical result.
  const existing = await prisma.vehicleRegistrationExtraction.findUnique({
    where: { assetDocumentId: doc.id },
    select: { id: true, documentSha256: true, parserVersion: true, status: true, failureCode: true, version: true },
  });
  if (existing && existing.documentSha256 === documentSha256 && existing.parserVersion === REGISTRATION_PARSER_VERSION) {
    return { ok: true, extractionId: existing.id, status: existing.status, failureCode: existing.failureCode, idempotent: true };
  }

  // 4) Extract text (bounded, hardened) then parse (pure). No raw text/bytes are ever logged
  //    or persisted; PII is discarded by the parser before this point.
  const pdfResult = await deps.extractPdfText(bytes);

  let status: RegistrationExtractionStatus;
  let failureCode: string | null = null;
  let fields: Prisma.InputJsonValue | typeof Prisma.JsonNull = Prisma.JsonNull;
  let warnings: Prisma.InputJsonValue | typeof Prisma.JsonNull = Prisma.JsonNull;
  let typed = {
    extractedVin: null as string | null,
    extractedPlateNumber: null as string | null,
    extractedLicensedPassengerCapacity: null as number | null,
    extractedManufactureYear: null as number | null,
    licenseExpiryDate: null as string | null,
  };

  if (!pdfResult.ok) {
    status = "FAILED";
    failureCode = pdfResult.code;
  } else {
    const parsed = parseOmanVehicleRegistration(pdfResult.text);
    status = parsed.overallStatus;
    if (parsed.overallStatus === "FAILED") failureCode = "UNSUPPORTED_LAYOUT";
    fields = serializePersistedFields(parsed);
    warnings = serializeWarnings(parsed);
    typed = extractionTypedColumns(parsed);
  }

  // 5) Persist (upsert — one active extraction per document) + audit, in ONE transaction so a
  //    failure leaves NO partial record. Audit metadata carries NO extracted values or PII.
  try {
    const now = new Date();
    const saved = await prisma.$transaction(async (tx) => {
      const row = await tx.vehicleRegistrationExtraction.upsert({
        where: { assetDocumentId: doc.id },
        create: {
          assetId: doc.assetId,
          assetDocumentId: doc.id,
          documentSha256,
          parserVersion: REGISTRATION_PARSER_VERSION,
          source: REGISTRATION_EXTRACTION_SOURCE,
          status,
          failureCode,
          ...typed,
          fields,
          warnings,
          processedAt: now,
        },
        update: {
          documentSha256,
          parserVersion: REGISTRATION_PARSER_VERSION,
          source: REGISTRATION_EXTRACTION_SOURCE,
          status,
          failureCode,
          ...typed,
          fields,
          warnings,
          processedAt: now,
          version: (existing?.version ?? 0) + 1,
        },
        select: { id: true, status: true, failureCode: true },
      });
      await recordAuditEvent(
        {
          actorType: "SYSTEM",
          actorId: null,
          action: "vehicle.registration_extracted",
          entityType: "Vehicle",
          entityId: doc.assetId,
          // Metadata only — never extracted values, never PII, never the object key/text.
          newValue: { status, source: REGISTRATION_EXTRACTION_SOURCE, parserVersion: REGISTRATION_PARSER_VERSION, failureCode: failureCode ?? null },
        },
        tx,
      );
      return row;
    });
    return { ok: true, extractionId: saved.id, status: saved.status, failureCode: saved.failureCode, idempotent: false };
  } catch (error) {
    logger.error("registrationExtraction.persist_failed", {
      assetDocumentId: doc.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
