import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApprovedProvider } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { logger } from "@/lib/logger";
import { parseConfirmation } from "./confirmation-input";
import { mapExtractedByField } from "./extracted-mapping";
import { isExtractionInProgress } from "@/lib/vehicles/registration-extraction/processing-lease";
import { computeFieldDecisions, correctedFieldCount } from "./diff";
import { confirmationColumns, serializeFieldDecisions } from "./confirmation-record";
import type { RegistrationReviewResult } from "./registration-review-result";

// Phase 3C Slice 3A — the single transactional writer for a provider confirmation CLAIM (DRAFT save
// and SUBMIT). Owner-scoped + session-derived (never a client provider id); re-reads the asset /
// document / extraction / active claim on the tx client; enforces the SUPERSESSION rule when the
// document was replaced; guards every write with a version CAS; records a privacy-safe audit event.
// It NEVER writes the authoritative Vehicle row.

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export async function writeRegistrationConfirmation(
  mode: "DRAFT" | "SUBMIT",
  vehicleId: string,
  rawInput: Record<string, unknown>,
): Promise<RegistrationReviewResult> {
  if (!isValidUuid(vehicleId)) return { ok: false, code: "VEHICLE_NOT_FOUND" };
  const { barqUser, provider } = await requireApprovedProvider();

  const parsed = parseConfirmation(rawInput, mode);
  if (!parsed.ok) return { ok: false, code: "INVALID_INPUT", fieldErrors: parsed.errors };

  try {
    return await prisma.$transaction(async (tx) => {
      const asset = await tx.asset.findFirst({
        where: { id: vehicleId, providerId: provider.id, assetType: "VEHICLE" },
        select: {
          id: true,
          documents: {
            where: { type: "VEHICLE_REGISTRATION" },
            select: {
              id: true,
              registrationExtraction: { select: { id: true, documentSha256: true, parserVersion: true, fields: true, status: true, processingExpiresAt: true } },
              registrationConfirmations: {
                where: { status: { not: "SUPERSEDED" } },
                select: { id: true, status: true, version: true, boundDocumentSha256: true, boundParserVersion: true },
              },
            },
          },
        },
      });
      if (!asset) return { ok: false, code: "VEHICLE_NOT_FOUND" } as const;
      const doc = asset.documents[0];
      if (!doc) return { ok: false, code: "DOCUMENT_NOT_FOUND" } as const;
      const extraction = doc.registrationExtraction;
      if (!extraction) return { ok: false, code: "EXTRACTION_NOT_READY" } as const;
      // The document is being read right now (an OCR call is in flight): its suggestions are about
      // to arrive, so nothing is confirmed against a half-finished extraction. Bounded by the lease.
      if (isExtractionInProgress(extraction)) return { ok: false, code: "EXTRACTION_NOT_READY" } as const;

      const active = doc.registrationConfirmations[0] ?? null;
      const stale = active
        ? active.boundDocumentSha256 !== extraction.documentSha256 || active.boundParserVersion !== extraction.parserVersion
        : false;

      // Fix 1 — on a document-hash / parser-version change, ANY stale active claim (DRAFT or
      // SUBMITTED) is marked SUPERSEDED AS-IS and preserved as immutable historical evidence. It is
      // NEVER rebound and its provider values / decisions / declaration are NEVER carried forward.
      // We do NOT write the submitted values here: the provider must re-review the NEW extraction
      // (the reader then shows a fresh form prefilled only from the new suggestions; a re-submit
      // creates a clean claim). This also closes the stale-tab race (a stale save can't resurrect or
      // mutate the superseded row, nor inject old values into the new document).
      if (active && stale) {
        const superseded = await tx.vehicleRegistrationConfirmation.updateMany({
          where: { id: active.id, version: active.version, status: { not: "SUPERSEDED" } },
          data: { status: "SUPERSEDED" },
        });
        if (superseded.count === 0) return { ok: false, code: "CONFLICT" } as const;
        await recordAuditEvent(
          { actorType: "PROVIDER", actorId: provider.id, action: "vehicle.registration_confirmation_superseded", entityType: "Vehicle", entityId: asset.id, previousValue: { status: active.status }, newValue: { status: "SUPERSEDED" } },
          tx,
        );
        return { ok: false, code: "SUPERSEDED" } as const;
      }

      // A current (non-stale) SUBMITTED claim is locked — never silently rewritten.
      if (active && active.status === "SUBMITTED") return { ok: false, code: "LOCKED" } as const;

      const extractedValues = mapExtractedByField(extraction.fields).values;
      const decisions = computeFieldDecisions(extractedValues, parsed.values);
      const now = new Date();
      const common = {
        ...confirmationColumns(parsed.values),
        fieldDecisions: serializeFieldDecisions(decisions),
        boundDocumentSha256: extraction.documentSha256,
        boundParserVersion: extraction.parserVersion,
        status: mode === "SUBMIT" ? ("SUBMITTED" as const) : ("DRAFT" as const),
        declarationAccepted: parsed.declarationAccepted,
        submittedAt: mode === "SUBMIT" ? now : null,
        submittedByUserId: mode === "SUBMIT" ? barqUser.id : null,
      };

      const auditAction = mode === "SUBMIT" ? "vehicle.registration_confirmation_submitted" : "vehicle.registration_confirmation_draft_saved";
      const auditMeta = { status: common.status, correctedFields: correctedFieldCount(decisions) }; // metadata only — no values/PII

      if (active) {
        // Update the existing editable DRAFT (fresh or stale-rebound), guarded on version.
        const upd = await tx.vehicleRegistrationConfirmation.updateMany({
          where: { id: active.id, version: active.version },
          data: { ...common, version: active.version + 1 },
        });
        if (upd.count === 0) return { ok: false, code: "CONFLICT" } as const;
        await recordAuditEvent({ actorType: "PROVIDER", actorId: provider.id, action: auditAction, entityType: "Vehicle", entityId: asset.id, newValue: auditMeta }, tx);
        return { ok: true } as const;
      }

      // No active claim → create one (partial-unique index makes a concurrent create a P2002 → CONFLICT).
      await tx.vehicleRegistrationConfirmation.create({
        data: { providerId: provider.id, assetId: asset.id, assetDocumentId: doc.id, extractionId: extraction.id, ...common },
      });
      await recordAuditEvent({ actorType: "PROVIDER", actorId: provider.id, action: auditAction, entityType: "Vehicle", entityId: asset.id, newValue: auditMeta }, tx);
      return { ok: true } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, code: "CONFLICT" };
    logger.error("registrationConfirmation.write_failed", { vehicleId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, code: "UNKNOWN_ERROR" };
  }
}
