"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";

// Activate Administrator — User & Access Management (Batch 3). Sets an existing
// Admin row's status to ACTIVE (reactivation of a DEACTIVATED admin). Never
// creates a duplicate row. Idempotent: an already-ACTIVE admin returns a clear
// already-active outcome without a mutation or audit event.

export type ActivateAdminErrorCode = "INVALID_INPUT" | "NO_ADMIN_PROFILE" | "ADMIN_NOT_FOUND" | "UNKNOWN_ERROR";

export type ActivateAdminOutcome = "activated" | "already_active";

export type ActivateAdminResult = { ok: true; outcome: ActivateAdminOutcome } | { ok: false; error: ActivateAdminErrorCode };

export async function activateAdmin(adminId: string): Promise<ActivateAdminResult> {
  if (!isValidUuid(adminId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  let actorAdmin;
  try {
    const auth = await requireAdmin();
    actorAdmin = auth.admin;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/");
    }
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "NO_ADMIN_PROFILE" };
    }
    throw error;
  }

  try {
    const target = await prisma.admin.findUnique({ where: { id: adminId } });
    if (!target) {
      return { ok: false, error: "ADMIN_NOT_FOUND" };
    }
    if (target.status === "ACTIVE") {
      return { ok: true, outcome: "already_active" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.admin.update({ where: { id: adminId }, data: { status: "ACTIVE" } });
      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: actorAdmin.id,
          action: "admin.activated",
          entityType: "Admin",
          entityId: adminId,
          previousValue: { status: target.status },
          newValue: { status: "ACTIVE" },
        },
        tx
      );
    });
    return { ok: true, outcome: "activated" };
  } catch (error) {
    logger.error("activateAdmin.unexpected_error", {
      adminId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
