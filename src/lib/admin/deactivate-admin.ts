"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";

// Deactivate Administrator — User & Access Management (Batch 3). Never
// hard-deletes; sets Admin.status = DEACTIVATED. Enforces the "last ACTIVE
// administrator" protection ATOMICALLY: inside one interactive transaction it
// takes a row lock on every ACTIVE admin (`SELECT ... FOR UPDATE`), so
// concurrent deactivations serialize and can never race the platform down to
// zero active admins. The self-deactivation guard is a subset of this — if the
// caller is the final ACTIVE admin, the active count is 1 and the same rule
// rejects it. Idempotent: an already-DEACTIVATED target is a no-op success.

export type DeactivateAdminErrorCode =
  | "INVALID_INPUT"
  | "NO_ADMIN_PROFILE"
  | "ADMIN_NOT_FOUND"
  | "LAST_ACTIVE_ADMIN"
  | "UNKNOWN_ERROR";

export type DeactivateAdminOutcome = "deactivated" | "already_deactivated";

export type DeactivateAdminResult =
  | { ok: true; outcome: DeactivateAdminOutcome }
  | { ok: false; error: DeactivateAdminErrorCode };

export async function deactivateAdmin(adminId: string): Promise<DeactivateAdminResult> {
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
    return await prisma.$transaction(async (tx): Promise<DeactivateAdminResult> => {
      // Lock every ACTIVE admin row so a concurrent deactivation blocks until
      // this transaction commits, then re-reads the (smaller) active set —
      // making the count-then-mutate genuinely race-safe, not just
      // read-committed. The lock is held for the rest of the transaction.
      const activeAdmins = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "admins" WHERE status = 'ACTIVE' FOR UPDATE
      `;

      const target = await tx.admin.findUnique({ where: { id: adminId } });
      if (!target) {
        return { ok: false, error: "ADMIN_NOT_FOUND" };
      }
      if (target.status !== "ACTIVE") {
        return { ok: true, outcome: "already_deactivated" };
      }
      // Deactivating this ACTIVE admin must leave at least one ACTIVE admin.
      if (activeAdmins.length <= 1) {
        return { ok: false, error: "LAST_ACTIVE_ADMIN" };
      }

      await tx.admin.update({ where: { id: adminId }, data: { status: "DEACTIVATED" } });
      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: actorAdmin.id,
          action: "admin.deactivated",
          entityType: "Admin",
          entityId: adminId,
          previousValue: { status: "ACTIVE" },
          newValue: { status: "DEACTIVATED" },
        },
        tx
      );
      return { ok: true, outcome: "deactivated" };
    });
  } catch (error) {
    logger.error("deactivateAdmin.unexpected_error", {
      adminId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
