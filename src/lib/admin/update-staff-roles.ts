"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { parseStaffRoles, sameRoleSet } from "./staff-roles";

// Update Staff roles — User & Access Management (Batch 4). Replaces the entire
// role set with a validated, deduplicated, canonically-ordered set. Idempotent:
// an unchanged set returns already_current with no mutation or audit event.

export type UpdateStaffRolesErrorCode =
  | "INVALID_INPUT"
  | "EMPTY_ROLES"
  | "INVALID_ROLE"
  | "NO_ADMIN_PROFILE"
  | "STAFF_NOT_FOUND"
  | "UNKNOWN_ERROR";

export type UpdateStaffRolesOutcome = "roles_updated" | "already_current";

export type UpdateStaffRolesResult =
  | { ok: true; outcome: UpdateStaffRolesOutcome }
  | { ok: false; error: UpdateStaffRolesErrorCode };

export async function updateStaffRoles(staffId: string, rolesInput: string[]): Promise<UpdateStaffRolesResult> {
  if (!isValidUuid(staffId)) return { ok: false, error: "INVALID_INPUT" };

  const parsed = parseStaffRoles(rolesInput ?? []);
  if (!parsed.ok) {
    return { ok: false, error: parsed.reason === "empty" ? "EMPTY_ROLES" : "INVALID_ROLE" };
  }
  const roles = parsed.roles;

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
    if (sameRoleSet(staff.roles, roles)) return { ok: true, outcome: "already_current" };

    await prisma.$transaction(async (tx) => {
      await tx.staff.update({ where: { id: staffId }, data: { roles } });
      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: actorAdmin.id,
          action: "staff.roles_updated",
          entityType: "Staff",
          entityId: staffId,
          previousValue: { roles: staff.roles },
          newValue: { roles },
        },
        tx
      );
    });
    return { ok: true, outcome: "roles_updated" };
  } catch (error) {
    logger.error("updateStaffRoles.unexpected_error", { staffId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
