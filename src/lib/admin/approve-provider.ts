"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { notifyProviderOfEvent, PROVIDER_NOTIFICATION_EVENT } from "@/lib/notifications/provider-notification-events";
import { assertProviderApprovable } from "@/lib/provider/documents/assert-provider-approvable";
import type { RequiredDocumentBlocker } from "@/lib/provider-document-types";

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
  // Provider Verification & Documents (Gate 3) — server-side completeness gate:
  // required verification documents are missing or not APPROVED.
  | "INCOMPLETE_DOCUMENTS"
  | "UNKNOWN_ERROR";

export type ApproveProviderResult =
  | { ok: true }
  | { ok: false; error: ApproveProviderErrorCode; blockers?: RequiredDocumentBlocker[] };

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

    // Provider Verification & Documents (Gate 3) — server-side completeness gate.
    // A disabled Approve button is NOT sufficient; enforce here. If required
    // documents are missing or not yet APPROVED, refuse WITHOUT transitioning,
    // auditing, or notifying — the successful-approval path below is unchanged
    // once there are no blockers. Existing APPROVED providers are unaffected
    // (this runs only on an APPLIED/UNDER_REVIEW -> APPROVED transition).
    const blockers = await assertProviderApprovable(providerId);
    if (blockers.length > 0) {
      return { ok: false, error: "INCOMPLETE_DOCUMENTS", blockers };
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

    // Customer → Provider Journey (C) — notify the provider AFTER the approval
    // transaction has committed, never inside it: a notification write must
    // never be able to roll back an approval. Fire-and-forget with its own
    // try/catch so a notification failure is logged but can NEVER fail the
    // approval (which has already durably succeeded) — and, critically, so it
    // never reaches this function's outer catch, which would otherwise turn a
    // succeeded approval into a misleading UNKNOWN_ERROR result. This mirrors
    // the post-commit notification pattern used across the booking lifecycle.
    try {
      await notifyProviderOfEvent(PROVIDER_NOTIFICATION_EVENT.APPROVED, {
        providerUserId: provider.userId,
        providerId,
      });
    } catch (notifyError) {
      logger.error("approveProvider.notification_failed", {
        providerId,
        message: notifyError instanceof Error ? notifyError.message : String(notifyError),
      });
    }

    return { ok: true };
  } catch (error) {
    logger.error("approveProvider.unexpected_error", {
      providerId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
