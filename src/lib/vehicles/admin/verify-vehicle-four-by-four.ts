"use server";

import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { VehicleAdminActionResult } from "./vehicle-admin-errors";

// TOUR-VEHICLE-CAP — the ONLY writer of the TRUSTED 4x4 capability
// (Vehicle.fourByFourVerified). Admin-only (requireAdmin; a provider/customer can
// never reach it, and no provider API/form accepts the trusted field). Establishes
// the admin-confirmed fact used by isVehicleFourByFourCapable / future GUIDE_WITH_4X4
// eligibility — NEVER inferred from make/model/vehicleType, and independent of the
// provider's advisory `claimedFourByFour`. Distinct from document verification /
// operational activation: this touches ONLY the capability flag, never Asset.status,
// verificationStatus, documents, or expiry. Records an audit event; no notification.
//
// `verified: true`  => confirmed 4x4-capable.
// `verified: false` => confirmed NOT 4x4-capable.
// (The un-reviewed default is null, which fails closed for eligibility.)

export async function verifyVehicleFourByFour(assetId: string, verified: boolean): Promise<VehicleAdminActionResult> {
  if (!isValidUuid(assetId)) return { ok: false, error: "INVALID_INPUT" };
  if (typeof verified !== "boolean") return { ok: false, error: "INVALID_INPUT" };

  let adminId: string;
  try {
    const { admin } = await requireAdmin();
    adminId = admin.id;
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: "NO_ADMIN_PROFILE" };
    if (error instanceof UnauthenticatedError) throw error;
    throw error;
  }

  const asset = await prisma.asset.findFirst({
    where: { id: assetId, assetType: "VEHICLE" },
    select: { vehicle: { select: { fourByFourVerified: true } } },
  });
  if (!asset || !asset.vehicle) return { ok: false, error: "VEHICLE_NOT_FOUND" };
  const previous = asset.vehicle.fourByFourVerified;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.vehicle.update({
        where: { assetId },
        data: {
          // ONLY the trusted capability flag — nothing else on the vehicle or asset.
          fourByFourVerified: verified,
        },
      });
      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: adminId,
          action: "vehicle.four_by_four_verified",
          entityType: "Vehicle",
          entityId: assetId,
          previousValue: { fourByFourVerified: previous },
          newValue: { fourByFourVerified: verified },
        },
        tx,
      );
    });
    return { ok: true };
  } catch (error) {
    logger.error("verifyVehicleFourByFour.db_failed", { assetId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
