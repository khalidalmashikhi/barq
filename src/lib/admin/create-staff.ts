"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { parseStaffRoles, sameRoleSet } from "./staff-roles";
import type { StaffRole } from "@prisma/client";

// Create / upsert Staff — User & Access Management (Batch 4). Promotes an
// existing, verified BARQ User (matched by normalized phone) to Staff with a
// validated role set. Mirrors add-admin.ts's shape. Never creates a duplicate
// Staff row (Staff.userId is unique):
//   - existing ACTIVE staff with the SAME roles -> already_current (no-op)
//   - existing ACTIVE staff with DIFFERENT roles -> roles updated
//   - existing DEACTIVATED staff -> reactivated AND roles applied, one tx
// A SUSPENDED/DEACTIVATED User is never silently reactivated (USER_INACTIVE).
// Only the Staff row is touched — any Admin/Customer/Provider profile the same
// User may hold is left untouched.

export type CreateStaffErrorCode =
  | "INVALID_INPUT"
  | "EMPTY_ROLES"
  | "INVALID_ROLE"
  | "NO_ADMIN_PROFILE"
  | "USER_NOT_FOUND"
  | "USER_NOT_VERIFIED"
  | "USER_INACTIVE"
  | "UNKNOWN_ERROR";

export type CreateStaffOutcome = "created" | "reactivated" | "roles_updated" | "already_current";

export type CreateStaffResult = { ok: true; outcome: CreateStaffOutcome } | { ok: false; error: CreateStaffErrorCode };

export async function createStaff(phoneNumberInput: string, rolesInput: string[]): Promise<CreateStaffResult> {
  const phoneNumber = (phoneNumberInput ?? "").trim().replace(/\s+/g, "");
  if (!phoneNumber) {
    return { ok: false, error: "INVALID_INPUT" };
  }

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
    const user = await prisma.user.findUnique({ where: { phoneNumber }, include: { staff: true } });
    if (!user) return { ok: false, error: "USER_NOT_FOUND" };
    if (!user.phoneNumberVerified) return { ok: false, error: "USER_NOT_VERIFIED" };
    if (user.status === "SUSPENDED" || user.status === "DEACTIVATED") return { ok: false, error: "USER_INACTIVE" };

    if (user.staff) {
      const staff = user.staff;
      if (staff.status === "ACTIVE") {
        if (sameRoleSet(staff.roles, roles)) {
          return { ok: true, outcome: "already_current" };
        }
        await prisma.$transaction(async (tx) => {
          await tx.staff.update({ where: { id: staff.id }, data: { roles } });
          await recordAuditEvent(
            {
              actorType: "ADMIN",
              actorId: actorAdmin.id,
              action: "staff.roles_updated",
              entityType: "Staff",
              entityId: staff.id,
              previousValue: { roles: staff.roles },
              newValue: { roles },
            },
            tx
          );
        });
        return { ok: true, outcome: "roles_updated" };
      }

      // DEACTIVATED -> reactivate and apply the requested roles atomically.
      const previousRoles = staff.roles;
      await prisma.$transaction(async (tx) => {
        await tx.staff.update({ where: { id: staff.id }, data: { status: "ACTIVE", roles } });
        await recordAuditEvent(
          {
            actorType: "ADMIN",
            actorId: actorAdmin.id,
            action: "staff.reactivated",
            entityType: "Staff",
            entityId: staff.id,
            previousValue: { status: "DEACTIVATED", roles: previousRoles },
            newValue: { status: "ACTIVE", roles },
          },
          tx
        );
      });
      return { ok: true, outcome: "reactivated" };
    }

    await prisma.$transaction(async (tx) => {
      const staff = await tx.staff.create({ data: { userId: user.id, roles: roles as StaffRole[], status: "ACTIVE" } });
      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: actorAdmin.id,
          action: "staff.created",
          entityType: "Staff",
          entityId: staff.id,
          newValue: { status: "ACTIVE", roles },
        },
        tx
      );
    });
    return { ok: true, outcome: "created" };
  } catch (error) {
    logger.error("createStaff.unexpected_error", { message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
