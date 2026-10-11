import "server-only";
import { prisma } from "@/lib/db";
import { requireApprovedProvider } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { safeErrorCategory } from "@/lib/vehicles/documents/safe-error-category";
import { REGISTRATION_PARSER_VERSION } from "@/lib/vehicles/registration-extraction/constants";
import { runVehicleRegistrationExtraction, type ExtractionServiceDeps } from "@/lib/vehicles/registration-extraction/extract-registration-service";
import { isConfirmationStale } from "./review-status";
import type { RegistrationReviewCode } from "./registration-review-result";

// Phase 3C (incomplete native-PDF correction, 2026-10-09) — "Read document again".
//
// A reading stored under an OLDER semantic-analysis version is shown to the provider as STALE (the
// review read model derives that on the server; a GET never re-reads or writes anything). This is
// the ONLY way such a reading is re-read: the provider asks for it, for their own vehicle.
//
//   • owner-scoped and session-derived like every registration-review mutation;
//   • LOCAL ONLY — the deterministic stage over the stored document set (a PDF text layer, or the
//     stored per-field text of an earlier automatic reading). It never makes an external request,
//     whatever consent exists;
//   • idempotent and race-safe — two concurrent re-reads converge on ONE current row through the
//     extraction service's version CAS; a current reading is answered without any work;
//   • the provider's saved DRAFT is kept: when the document bytes are unchanged, the active DRAFT is
//     re-bound to the new version so their own entries stay theirs (a SUBMITTED claim locks the
//     re-read instead);
//   • audited with ids, versions and the outcome only — never document text or vehicle values.

export type RereadResult = { ok: true; changed: boolean } | { ok: false; code: RegistrationReviewCode };

export async function rereadRegistrationDocument(vehicleId: string, deps?: ExtractionServiceDeps): Promise<RereadResult> {
  if (!isValidUuid(vehicleId)) return { ok: false, code: "VEHICLE_NOT_FOUND" };
  const { barqUser, provider } = await requireApprovedProvider();

  const asset = await prisma.asset.findFirst({
    where: { id: vehicleId, providerId: provider.id, assetType: "VEHICLE" },
    select: {
      id: true,
      documents: {
        where: { type: "VEHICLE_REGISTRATION" },
        select: {
          id: true,
          registrationExtraction: { select: { status: true, failureCode: true, documentSha256: true, parserVersion: true, processingExpiresAt: true } },
          registrationConfirmations: { where: { status: { not: "SUPERSEDED" } }, select: { id: true, status: true, boundDocumentSha256: true, boundParserVersion: true } },
        },
      },
    },
  });
  if (!asset) return { ok: false, code: "VEHICLE_NOT_FOUND" };
  const doc = asset.documents[0];
  if (!doc) return { ok: false, code: "DOCUMENT_NOT_FOUND" };
  const before = doc.registrationExtraction;
  if (!before) return { ok: false, code: "EXTRACTION_NOT_READY" };
  const active = doc.registrationConfirmations[0] ?? null;
  if (active && active.status === "SUBMITTED" && !isConfirmationStale(active, before)) return { ok: false, code: "LOCKED" };

  // Already current → nothing to do (a reload or a second click never re-reads).
  if (before.parserVersion === REGISTRATION_PARSER_VERSION) return { ok: true, changed: false };

  const res = await runVehicleRegistrationExtraction({ assetDocumentId: doc.id, actorUserId: barqUser.id }, deps, { localOnly: true });
  if (!res.ok) {
    if (res.error === "STORAGE_NOT_CONFIGURED") return { ok: false, code: "STORAGE_NOT_CONFIGURED" };
    if (res.error === "DOCUMENT_NOT_FOUND" || res.error === "WRONG_DOCUMENT_TYPE" || res.error === "NOT_A_VEHICLE") return { ok: false, code: "DOCUMENT_NOT_FOUND" };
    return { ok: false, code: "EXTRACTION_FAILED" };
  }

  const after = await prisma.vehicleRegistrationExtraction.findUnique({ where: { assetDocumentId: doc.id }, select: { documentSha256: true, parserVersion: true } });
  const changed = !!after && after.parserVersion === REGISTRATION_PARSER_VERSION;

  try {
    await prisma.$transaction(async (tx) => {
      let draftRebound = false;
      // Same bytes, new rules: the provider's own DRAFT entries stay theirs.
      if (changed && after && active && active.status === "DRAFT" && active.boundDocumentSha256 === after.documentSha256 && active.boundParserVersion === before.parserVersion) {
        const upd = await tx.vehicleRegistrationConfirmation.updateMany({
          where: { id: active.id, status: "DRAFT", boundDocumentSha256: after.documentSha256, boundParserVersion: before.parserVersion },
          data: { boundParserVersion: REGISTRATION_PARSER_VERSION, version: { increment: 1 } },
        });
        draftRebound = upd.count === 1;
      }
      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: provider.id,
          action: "vehicle.registration_reread_requested",
          entityType: "Vehicle",
          entityId: asset.id,
          // Metadata only — versions and the outcome. Never document text or vehicle values.
          newValue: { previousParserVersion: before.parserVersion, parserVersion: after?.parserVersion ?? null, changed, externalCall: false, draftRebound, outcomeStatus: res.status },
        },
        tx,
      );
    });
  } catch (error) {
    // The (deterministic, idempotent) re-read itself is already stored; only the bookkeeping failed.
    logger.error("registrationReread.audit_failed", { vehicleId, error: safeErrorCategory(error) });
    return { ok: false, code: "UNKNOWN_ERROR" };
  }
  return { ok: true, changed };
}
