import "server-only";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, ForbiddenError } from "@/lib/auth";
import { canViewRentalWorkspace } from "@/lib/offerings/rental/provider/rental-workspace-access";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { logger } from "@/lib/logger";
import { isValidUuid } from "@/lib/uuid";
import { enqueuePrivateObjectCleanup, attemptPrivateObjectCleanup } from "@/lib/storage/cleanup/private-object-cleanup";
import type { DeleteDraftResult } from "./onboarding-result";

// Phase 3C — Vehicle Creation from Registration, Slice 3B. Cancels an UNFINISHED onboarding shell
// (the wizard "Cancel"/abandon path) and reclaims its private registration document.
//
// Strictly pre-creation: a shell is deletable ONLY while it is still a blank DRAFT — operational
// status REGISTERED, verification DRAFT, and NO submitted confirmation claim. The moment finalize
// locks a SUBMITTED claim (the Vehicle now carries confirmed values) it is a real managed vehicle
// and this path refuses (NOT_DELETABLE); discarding it then is a different, deliberate action.
//
// Owner-scoped, session-derived, RENTAL_COMPANY-gated. The DB rows are removed in one transaction
// in FK-safe order (Vehicle→Asset is RESTRICT, so the Vehicle and all children go before the
// Asset). In that SAME transaction a DURABLE PrivateObjectCleanupTask is recorded for each private
// document object (server-derived keys), so a storage-delete failure can never strand the file: it
// is retried to completion by the cleanup cron. An immediate deletion is attempted after commit;
// only a failure persists for retry. Graph deletion + audit + cleanup enqueue commit or roll back
// together.

class ShellGone extends Error {}
class ShellNotDeletable extends Error {}

export async function deleteDraftVehicle(vehicleId: string): Promise<DeleteDraftResult> {
  if (!isValidUuid(vehicleId)) return { ok: false, code: "VEHICLE_NOT_FOUND" };

  let provider;
  try {
    const auth = await requireApprovedProvider();
    provider = auth.provider;
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, code: "NOT_RENTAL_PROVIDER" };
    throw error;
  }
  if (!(await canViewRentalWorkspace(provider))) return { ok: false, code: "NOT_RENTAL_PROVIDER" };

  const asset = await prisma.asset.findFirst({
    where: { id: vehicleId, providerId: provider.id, assetType: "VEHICLE" },
    select: {
      id: true,
      status: true,
      verificationStatus: true,
      registrationConfirmations: { where: { status: "SUBMITTED" }, select: { id: true } },
    },
  });
  if (!asset) return { ok: false, code: "VEHICLE_NOT_FOUND" };

  // Only a blank, uncreated shell may be cancelled here.
  if (asset.status !== "REGISTERED" || asset.verificationStatus !== "DRAFT" || asset.registrationConfirmations.length > 0) {
    return { ok: false, code: "NOT_DELETABLE" };
  }

  let cleanupTaskIds: string[];
  try {
    cleanupTaskIds = await prisma.$transaction(async (tx) => {
      // Serialize against finalize / upload / replace on this shell: finalize takes the same row
      // lock, and a concurrent document INSERT needs a key-share lock on this row, so nothing can
      // slip in between the eligibility re-check below and the deletes.
      await tx.$queryRaw`SELECT "id" FROM "assets" WHERE "id" = ${asset.id}::uuid FOR UPDATE`;

      // AUTHORITATIVE re-check inside the transaction (the read above was only a fast path): the
      // shell must still be owned, blank, and NOT finalized. A finalize that committed first wins.
      const fresh = await tx.asset.findFirst({
        where: { id: asset.id, providerId: provider.id, assetType: "VEHICLE" },
        select: { status: true, verificationStatus: true, registrationConfirmations: { where: { status: "SUBMITTED" }, select: { id: true } } },
      });
      if (!fresh) throw new ShellGone();
      if (fresh.status !== "REGISTERED" || fresh.verificationStatus !== "DRAFT" || fresh.registrationConfirmations.length > 0) throw new ShellNotDeletable();

      await recordAuditEvent(
        { actorType: "PROVIDER", actorId: provider.id, action: "vehicle.onboarding_draft_deleted", entityType: "Vehicle", entityId: asset.id, previousValue: { status: fresh.status, verificationStatus: fresh.verificationStatus } },
        tx,
      );
      // FK-safe order: children first, then the Vehicle, then the base Asset.
      await tx.vehicleRegistrationConfirmation.deleteMany({ where: { assetId: asset.id } });
      await tx.vehicleRegistrationExtraction.deleteMany({ where: { assetId: asset.id } });
      // The cleanup targets are EXACTLY the document rows this statement removes (never a stale
      // pre-read): a replacement that committed first is seen with its new key; one that loses
      // finds its row gone and cleans up its own upload intent.
      const removed = await tx.$queryRaw<{ objectKey: string }[]>`DELETE FROM "asset_documents" WHERE "assetId" = ${asset.id}::uuid RETURNING "objectKey"`;
      const ids: string[] = [];
      for (const row of removed) {
        // Durable cleanup record in the SAME transaction as the graph removal + audit — all three
        // commit or roll back together.
        ids.push(await enqueuePrivateObjectCleanup(tx, { objectKey: row.objectKey, purpose: "VEHICLE_REGISTRATION_ONBOARDING" }));
      }
      await tx.vehicle.deleteMany({ where: { assetId: asset.id } });
      await tx.asset.delete({ where: { id: asset.id } });
      return ids;
    });
  } catch (error) {
    if (error instanceof ShellGone) return { ok: false, code: "VEHICLE_NOT_FOUND" };
    if (error instanceof ShellNotDeletable) return { ok: false, code: "NOT_DELETABLE" };
    logger.error("vehicleOnboarding.delete_shell_failed", { vehicleId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, code: "UNKNOWN_ERROR" };
  }

  // Immediate deletion attempt after commit; a transient failure stays durable for the cron to retry.
  for (const taskId of cleanupTaskIds) {
    await attemptPrivateObjectCleanup(taskId).catch((error) => {
      logger.warn("vehicleOnboarding.immediate_cleanup_threw", { message: error instanceof Error ? error.message : String(error) });
    });
  }
  return { ok: true };
}
