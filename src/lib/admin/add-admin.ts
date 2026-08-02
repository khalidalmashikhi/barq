"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";

// Add / grant Administrator — User & Access Management (Batch 3). Promotes an
// existing, verified BARQ User (matched by normalized phone number) to Admin.
// Mirrors approve-provider.ts's shape exactly: "use server", requireAdmin()
// with the same Unauthenticated/Forbidden handling, re-fetch-and-verify, a
// single $transaction wrapping the mutation + recordAuditEvent, typed result.
//
// Never creates a duplicate Admin row (Admin.userId is unique): an existing
// ACTIVE admin returns an honest already-active result; an existing DEACTIVATED
// admin is REACTIVATED in place. Per the approved RBAC design, a User whose
// status is SUSPENDED/DEACTIVATED (denied by requireAuth) is NOT silently
// reactivated — it returns a distinct USER_INACTIVE result so the caller
// restores the user first, deliberately, rather than as a hidden side effect.

export type AddAdminErrorCode =
  | "INVALID_INPUT"
  | "NO_ADMIN_PROFILE"
  | "USER_NOT_FOUND"
  | "USER_NOT_VERIFIED"
  | "USER_INACTIVE"
  | "UNKNOWN_ERROR";

export type AddAdminOutcome = "granted" | "reactivated" | "already_active";

export type AddAdminResult = { ok: true; outcome: AddAdminOutcome } | { ok: false; error: AddAdminErrorCode };

export async function addAdmin(phoneNumberInput: string): Promise<AddAdminResult> {
  const phoneNumber = (phoneNumberInput ?? "").trim().replace(/\s+/g, "");
  if (!phoneNumber) {
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
    const user = await prisma.user.findUnique({
      where: { phoneNumber },
      include: { admin: true },
    });

    if (!user) {
      return { ok: false, error: "USER_NOT_FOUND" };
    }
    if (!user.phoneNumberVerified) {
      return { ok: false, error: "USER_NOT_VERIFIED" };
    }
    // Approved design: never silently reactivate a punitively terminated user.
    if (user.status === "SUSPENDED" || user.status === "DEACTIVATED") {
      return { ok: false, error: "USER_INACTIVE" };
    }

    if (user.admin) {
      if (user.admin.status === "ACTIVE") {
        return { ok: true, outcome: "already_active" };
      }
      const previousStatus = user.admin.status;
      const adminId = user.admin.id;
      await prisma.$transaction(async (tx) => {
        await tx.admin.update({ where: { id: adminId }, data: { status: "ACTIVE" } });
        await recordAuditEvent(
          {
            actorType: "ADMIN",
            actorId: actorAdmin.id,
            action: "admin.granted",
            entityType: "Admin",
            entityId: adminId,
            previousValue: { status: previousStatus },
            newValue: { status: "ACTIVE", userId: user.id },
          },
          tx
        );
      });
      return { ok: true, outcome: "reactivated" };
    }

    await prisma.$transaction(async (tx) => {
      const admin = await tx.admin.create({ data: { userId: user.id, status: "ACTIVE" } });
      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: actorAdmin.id,
          action: "admin.granted",
          entityType: "Admin",
          entityId: admin.id,
          newValue: { status: "ACTIVE", userId: user.id },
        },
        tx
      );
    });
    return { ok: true, outcome: "granted" };
  } catch (error) {
    logger.error("addAdmin.unexpected_error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
