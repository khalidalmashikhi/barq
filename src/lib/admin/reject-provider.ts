"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { notifyProviderApplicationEvent } from "@/lib/provider/notify-provider-application";
import type { ProviderAdminActionErrorCode } from "./provider-admin-errors";

// Reject provider — Provider Review / Reject / Resubmit lifecycle. Mirrors
// approve-provider.ts's shape (requireAdmin, UUID validation, generic catch ->
// UNKNOWN_ERROR, in-transaction audit, post-commit fire-and-forget notify),
// with two lifecycle-specific additions:
//
//  1. A MANDATORY, trimmed rejection reason (blank/whitespace-only is rejected
//     with REASON_REQUIRED). It is stored on Provider.rejectionReason for the
//     applicant to read AND captured in the provider.rejected audit payload so
//     the history survives resubmission clearing the Provider field.
//
//  2. An OPTIMISTIC conditional transition guard: the status change is an
//     updateMany scoped to `WHERE status IN (APPLIED, UNDER_REVIEW)`, so a
//     concurrent approve/reject/archive — or a stale admin UI — matches 0 rows
//     and is reported as PROVIDER_NOT_PENDING instead of silently clobbering
//     the other transition. (approve-provider.ts's re-fetch-then-update is left
//     unchanged; this guard is the stronger pattern the new lifecycle adopts.)
//
// Existing approve semantics are untouched.

export type RejectProviderResult = { ok: true } | { ok: false; error: ProviderAdminActionErrorCode };

const REJECTABLE_PROVIDER_STATUSES = ["APPLIED", "UNDER_REVIEW"] as const;
const MAX_REASON_LENGTH = 2000;

export async function rejectProvider(providerId: string, reasonInput: string): Promise<RejectProviderResult> {
  if (!isValidUuid(providerId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const reason = typeof reasonInput === "string" ? reasonInput.trim() : "";
  if (reason.length === 0) {
    return { ok: false, error: "REASON_REQUIRED" };
  }
  if (reason.length > MAX_REASON_LENGTH) {
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
      select: { userId: true, status: true },
    });

    if (!provider) {
      return { ok: false, error: "PROVIDER_NOT_FOUND" };
    }

    if (!REJECTABLE_PROVIDER_STATUSES.includes(provider.status as (typeof REJECTABLE_PROVIDER_STATUSES)[number])) {
      return { ok: false, error: "PROVIDER_NOT_PENDING" };
    }

    const rejectedAt = new Date();

    const transitioned = await prisma.$transaction(async (tx) => {
      // Optimistic guard — only transition a provider that is STILL rejectable.
      // A concurrent transition makes this match 0 rows.
      const updated = await tx.provider.updateMany({
        where: { id: providerId, status: { in: [...REJECTABLE_PROVIDER_STATUSES] } },
        data: {
          status: "REJECTED",
          rejectionReason: reason,
          rejectedAt,
          rejectedByAdminId: admin.id,
        },
      });

      if (updated.count === 0) {
        return false;
      }

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "provider.rejected",
          entityType: "Provider",
          entityId: providerId,
          previousValue: { status: provider.status },
          // Reason retained here permanently — this survives resubmission, which
          // clears Provider.rejectionReason but never touches the audit trail.
          newValue: {
            status: "REJECTED",
            reason,
            rejectedAt: rejectedAt.toISOString(),
            rejectedByAdminId: admin.id,
          },
        },
        tx
      );

      return true;
    });

    if (!transitioned) {
      // Lost the race: another transition already moved this provider.
      return { ok: false, error: "PROVIDER_NOT_PENDING" };
    }

    // Post-commit, fire-and-forget — a notification failure must NEVER roll back
    // or fail the (already durable) rejection, and must never surface as the
    // outer UNKNOWN_ERROR, so it has its own try/catch. No external email/SMS is
    // dispatched — this is the in-app Notification Center row only.
    try {
      await notifyProviderApplicationEvent({ userId: provider.userId, kind: "PROVIDER_REJECTED" });
    } catch (notifyError) {
      logger.error("rejectProvider.notification_failed", {
        providerId,
        message: notifyError instanceof Error ? notifyError.message : String(notifyError),
      });
    }

    return { ok: true };
  } catch (error) {
    logger.error("rejectProvider.unexpected_error", {
      providerId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
