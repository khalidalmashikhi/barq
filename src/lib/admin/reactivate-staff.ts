"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";

// Reactivate Staff — User & Access Management (Batch 4). Sets Staff.status =
// ACTIVE, PRESERVING the existing role set (no role change here — that is
// update-staff-roles.ts's job). Idempotent (already-ACTIVE is a no-op). Refuses
// if the underlying User is SUSPENDED/DEACTIVATED, since Batch 1 would deny that
// user access anyway — reactivating the staff row would be misleading.

export type ReactivateStaffErrorCode =
  | "INVALID_INPUT"
  | "NO_ADMIN_PROFILE"
  | "STAFF_NOT_FOUND"
  | "USER_INACTIVE"
  | "UNKNOWN_ERROR";

export type ReactivateStaffOutcome = "reactivated" | "already_active";

export type ReactivateStaffResult = { ok: true; outcome: ReactivateStaffOutcome } | { ok: false; error: ReactivateStaffErrorCode };

export async function reactivateStaff(staffId: string): Promise<ReactivateStaffResult> {
  if (!isValidUuid(staffId)) return { ok: false, error: "INVALID_INPUT" };

  let actorAdmin;
  try {
    const auth = await requireAdmin();
    actorAdmin = auth.admin;
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/");
    if (error instanceof ForbiddenError) return { ok: false, error: "NO_ADMIN_PROFILE" };
    throw error;
  }

  try {
    const staff = await prisma.staff.findUnique({ where: { id: staffId }, include: { user: { select: { status: true } } } });
    if (!staff) return { ok: false, error: "STAFF_NOT_FOUND" };
    if (staff.status === "ACTIVE") return { ok: true, outcome: "already_active" };
    if (staff.user.status === "SUSPENDED" || staff.user.status === "DEACTIVATED") {
      return { ok: false, error: "USER_INACTIVE" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.staff.update({ where: { id: staffId }, data: { status: "ACTIVE" } });
      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: actorAdmin.id,
          action: "staff.reactivated",
          entityType: "Staff",
          entityId: staffId,
          previousValue: { status: "DEACTIVATED", roles: staff.roles },
          newValue: { status: "ACTIVE", roles: staff.roles },
        },
        tx
      );
    });
    return { ok: true, outcome: "reactivated" };
  } catch (error) {
    logger.error("reactivateStaff.unexpected_error", { staffId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
