"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireOwner, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";

// Deactivate Staff — User & Access Management (Batch 4). Sets Staff.status =
// DEACTIVATED; never hard-deletes. Idempotent (already-DEACTIVATED is a no-op
// success). Touches only the Staff row — a User who is also an Admin/Customer/
// Provider keeps those profiles unchanged. No "last staff" floor exists.

export type DeactivateStaffErrorCode = "INVALID_INPUT" | "NO_ADMIN_PROFILE" | "STAFF_NOT_FOUND" | "UNKNOWN_ERROR";

export type DeactivateStaffOutcome = "deactivated" | "already_deactivated";

export type DeactivateStaffResult = { ok: true; outcome: DeactivateStaffOutcome } | { ok: false; error: DeactivateStaffErrorCode };

export async function deactivateStaff(staffId: string): Promise<DeactivateStaffResult> {
  if (!isValidUuid(staffId)) return { ok: false, error: "INVALID_INPUT" };

  // STAFF RBAC (Gate Z-3) — staff deactivation is OWNER-only.
  let actorAdmin;
  try {
    const auth = await requireOwner();
    actorAdmin = auth.admin;
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/");
    if (error instanceof ForbiddenError) return { ok: false, error: "NO_ADMIN_PROFILE" };
    throw error;
  }

  try {
    const staff = await prisma.staff.findUnique({ where: { id: staffId }, include: { user: { select: { authUserId: true } } } });
    if (!staff) return { ok: false, error: "STAFF_NOT_FOUND" };
    if (staff.status !== "ACTIVE") return { ok: true, outcome: "already_deactivated" };

    await prisma.$transaction(async (tx) => {
      await tx.staff.update({ where: { id: staffId }, data: { status: "DEACTIVATED" } });
      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: actorAdmin.id,
          action: "staff.deactivated",
          entityType: "Staff",
          entityId: staffId,
          previousValue: { status: "ACTIVE", roles: staff.roles },
          newValue: { status: "DEACTIVATED" },
        },
        tx
      );
    });

    // Gate Z-3 (§18) — immediately revoke the deactivated staff member's Better Auth
    // sessions so they cannot keep using cached internal privilege until natural expiry.
    // Best-effort + POST-commit: a failure here NEVER fails the deactivation, and is
    // defense-in-depth only — resolveInternalActor() already denies a non-ACTIVE Staff on
    // the very next protected request regardless of session state. No token value is logged.
    const authUserId = staff.user?.authUserId ?? null;
    if (authUserId) {
      try {
        const revoked = await prisma.session.deleteMany({ where: { userId: authUserId } });
        logger.info("deactivateStaff.sessions_revoked", { staffId, revokedCount: revoked.count });
      } catch (revokeError) {
        logger.error("deactivateStaff.session_revocation_failed", {
          staffId,
          message: revokeError instanceof Error ? revokeError.message : String(revokeError),
        });
      }
    }
    return { ok: true, outcome: "deactivated" };
  } catch (error) {
    logger.error("deactivateStaff.unexpected_error", { staffId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
