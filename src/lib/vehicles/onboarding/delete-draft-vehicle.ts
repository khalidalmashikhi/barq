import "server-only";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, ForbiddenError } from "@/lib/auth";
import { canViewRentalWorkspace } from "@/lib/offerings/rental/provider/rental-workspace-access";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { logger } from "@/lib/logger";
import { isValidUuid } from "@/lib/uuid";
import { removePrivateObject } from "@/lib/storage/storage";
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
// Asset); the private storage objects are removed best-effort AFTER commit (an orphaned object is
// harmless, a lost DB row is not).

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
      documents: { select: { objectKey: true } },
      registrationConfirmations: { where: { status: "SUBMITTED" }, select: { id: true } },
    },
  });
  if (!asset) return { ok: false, code: "VEHICLE_NOT_FOUND" };

  // Only a blank, uncreated shell may be cancelled here.
  if (asset.status !== "REGISTERED" || asset.verificationStatus !== "DRAFT" || asset.registrationConfirmations.length > 0) {
    return { ok: false, code: "NOT_DELETABLE" };
  }

  const objectKeys = asset.documents.map((d) => d.objectKey);

  try {
    await prisma.$transaction(async (tx) => {
      await recordAuditEvent(
        { actorType: "PROVIDER", actorId: provider.id, action: "vehicle.onboarding_draft_deleted", entityType: "Vehicle", entityId: asset.id, previousValue: { status: asset.status, verificationStatus: asset.verificationStatus } },
        tx,
      );
      // FK-safe order: children first, then the Vehicle, then the base Asset.
      await tx.vehicleRegistrationConfirmation.deleteMany({ where: { assetId: asset.id } });
      await tx.vehicleRegistrationExtraction.deleteMany({ where: { assetId: asset.id } });
      await tx.assetDocument.deleteMany({ where: { assetId: asset.id } });
      await tx.vehicle.deleteMany({ where: { assetId: asset.id } });
      await tx.asset.delete({ where: { id: asset.id } });
    });
  } catch (error) {
    logger.error("vehicleOnboarding.delete_shell_failed", { vehicleId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, code: "UNKNOWN_ERROR" };
  }

  // Best-effort private-object cleanup after the DB rows are gone.
  for (const key of objectKeys) {
    await removePrivateObject(key).catch((error) => {
      logger.warn("vehicleOnboarding.orphan_object", { message: error instanceof Error ? error.message : String(error) });
    });
  }
  return { ok: true };
}
