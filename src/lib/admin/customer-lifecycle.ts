"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";

// Customer lifecycle — User & Access Management (Batch 5). Customer access
// status IS User.status (Customer has no status of its own). These actions
// mutate ONLY User.status — never Admin/Staff/Provider/AuthUser/Session/Customer
// rows.
//
// MULTI-ROLE SAFETY: after Batch 1, User.status governs requireAuth() globally,
// so deactivating/suspending a User disables EVERY profile that User holds.
// Before a revoking transition we therefore refuse (USER_HAS_PRIVILEGED_ROLE)
// if the same User has an ACTIVE Admin or ACTIVE Staff profile — so a customer
// action can never silently disable an administrator or staff member.
// Provider overlap is intentionally allowed: a global User deactivation is the
// designed way to revoke ALL access (including provider), and the acting admin
// sees the provider status separately. Reactivation restores access and needs
// no such guard.

export type CustomerLifecycleErrorCode =
  | "INVALID_INPUT"
  | "NO_ADMIN_PROFILE"
  | "USER_NOT_FOUND"
  | "USER_HAS_PRIVILEGED_ROLE"
  | "UNKNOWN_ERROR";

export type DeactivateCustomerResult =
  | { ok: true; outcome: "deactivated" | "already_deactivated" }
  | { ok: false; error: CustomerLifecycleErrorCode };

export type SuspendCustomerResult =
  | { ok: true; outcome: "suspended" | "already_suspended" }
  | { ok: false; error: CustomerLifecycleErrorCode };

export type ReactivateCustomerResult =
  | { ok: true; outcome: "reactivated" | "already_active" }
  | { ok: false; error: CustomerLifecycleErrorCode };

async function resolveActorAdminId(): Promise<{ ok: true; adminId: string } | { ok: false; error: "NO_ADMIN_PROFILE" }> {
  try {
    const auth = await requireAdmin();
    return { ok: true, adminId: auth.admin.id };
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/");
    if (error instanceof ForbiddenError) return { ok: false, error: "NO_ADMIN_PROFILE" };
    throw error;
  }
}

async function hasActivePrivilegedRole(userId: string): Promise<boolean> {
  const [admin, staff] = await Promise.all([
    prisma.admin.findUnique({ where: { userId }, select: { status: true } }),
    prisma.staff.findUnique({ where: { userId }, select: { status: true } }),
  ]);
  return admin?.status === "ACTIVE" || staff?.status === "ACTIVE";
}

// Shared implementation for the two access-revoking transitions.
async function revokeAccess(
  userId: string,
  target: "DEACTIVATED" | "SUSPENDED",
  action: "customer.deactivated" | "customer.suspended",
  alreadyOutcome: "already_deactivated" | "already_suspended",
  doneOutcome: "deactivated" | "suspended"
): Promise<{ ok: true; outcome: string } | { ok: false; error: CustomerLifecycleErrorCode }> {
  if (!isValidUuid(userId)) return { ok: false, error: "INVALID_INPUT" };
  const actor = await resolveActorAdminId();
  if (!actor.ok) return actor;

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, status: true } });
    if (!user) return { ok: false, error: "USER_NOT_FOUND" };
    if (user.status === target) return { ok: true, outcome: alreadyOutcome };
    if (await hasActivePrivilegedRole(userId)) return { ok: false, error: "USER_HAS_PRIVILEGED_ROLE" };

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status: target } });
      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: actor.adminId,
          action,
          entityType: "User",
          entityId: userId,
          previousValue: { status: user.status },
          newValue: { status: target },
        },
        tx
      );
    });
    return { ok: true, outcome: doneOutcome };
  } catch (error) {
    logger.error(`${action}.unexpected_error`, { userId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}

export async function deactivateCustomer(userId: string): Promise<DeactivateCustomerResult> {
  return revokeAccess(userId, "DEACTIVATED", "customer.deactivated", "already_deactivated", "deactivated") as Promise<DeactivateCustomerResult>;
}

export async function suspendCustomer(userId: string): Promise<SuspendCustomerResult> {
  return revokeAccess(userId, "SUSPENDED", "customer.suspended", "already_suspended", "suspended") as Promise<SuspendCustomerResult>;
}

export async function reactivateCustomer(userId: string): Promise<ReactivateCustomerResult> {
  if (!isValidUuid(userId)) return { ok: false, error: "INVALID_INPUT" };
  const actor = await resolveActorAdminId();
  if (!actor.ok) return actor;

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, status: true } });
    if (!user) return { ok: false, error: "USER_NOT_FOUND" };
    if (user.status === "ACTIVE") return { ok: true, outcome: "already_active" };

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: actor.adminId,
          action: "customer.reactivated",
          entityType: "User",
          entityId: userId,
          previousValue: { status: user.status },
          newValue: { status: "ACTIVE" },
        },
        tx
      );
    });
    return { ok: true, outcome: "reactivated" };
  } catch (error) {
    logger.error("customer.reactivated.unexpected_error", { userId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
