"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
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
    const staff = await prisma.staff.findUnique({ where: { id: staffId } });
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
    return { ok: true, outcome: "deactivated" };
  } catch (error) {
    logger.error("deactivateStaff.unexpected_error", { staffId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
