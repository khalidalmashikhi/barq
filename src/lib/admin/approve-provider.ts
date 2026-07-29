"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";

// Approve provider — Phase 4.1 ("Complete the Booking Lifecycle"),
// requirement #6: "Build the minimum admin workflow required to make
// the Verified badge meaningful." Approve-only, deliberately: this is
// the literal minimum needed for "Verified Provider" to mean "an admin
// looked at this," not a full suspend/reject/deactivate workflow (a
// natural follow-on, out of this MVP's scope).
//
// Mirrors the shape of accept-booking.ts/reject-booking.ts: "use
// server", UUID validation, requireAdmin() with the same
// UnauthenticatedError/ForbiddenError handling, re-fetch-and-verify the
// current status before mutating, generic catch -> logged + generic
// error code.

export type ApproveProviderErrorCode =
  | "INVALID_INPUT"
  | "NO_ADMIN_PROFILE"
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_NOT_PENDING"
  | "UNKNOWN_ERROR";

export type ApproveProviderResult = { ok: true } | { ok: false; error: ApproveProviderErrorCode };

const APPROVABLE_PROVIDER_STATUSES = ["APPLIED", "UNDER_REVIEW"] as const;

export async function approveProvider(providerId: string): Promise<ApproveProviderResult> {
  if (!isValidUuid(providerId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  let admin;
  try {
    const auth = await requireAdmin();
    admin = auth.admin;
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
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
    });

    if (!provider) {
      return { ok: false, error: "PROVIDER_NOT_FOUND" };
    }

    if (!APPROVABLE_PROVIDER_STATUSES.includes(provider.status as (typeof APPROVABLE_PROVIDER_STATUSES)[number])) {
      return { ok: false, error: "PROVIDER_NOT_PENDING" };
    }

    const approvedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.provider.update({
        where: { id: providerId },
        data: {
          status: "APPROVED",
          approvedAt,
          approvedByAdminId: admin.id,
        },
      });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "provider.approved",
          entityType: "Provider",
          entityId: providerId,
          previousValue: { status: provider.status },
          newValue: { status: "APPROVED", approvedAt: approvedAt.toISOString(), approvedByAdminId: admin.id },
        },
        tx
      );
    });

    return { ok: true };
  } catch (error) {
    logger.error("approveProvider.unexpected_error", {
      providerId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
