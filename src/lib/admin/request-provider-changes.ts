"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { ProviderAdminActionErrorCode } from "./provider-admin-errors";

// Request Changes — Gate 1B. An admin RETURNS a submitted application for
// correction, DISTINCT from rejectProvider (which denies it). Mirrors
// reject-provider.ts's shape (requireAdmin, UUID validation, mandatory trimmed
// reason, OPTIMISTIC conditional transition guarded on the submitted statuses,
// in-transaction audit, generic catch -> UNKNOWN_ERROR) with three differences:
//
//  1. Transitions to CHANGES_REQUESTED (not REJECTED). Document mutation then
//     re-opens for the provider (isVerificationEditableStatus), and they must
//     EXPLICITLY re-submit (-> UNDER_REVIEW). No automatic re-submit.
//  2. The reason reuses the existing Provider.rejectionReason field (no new
//     column); it is CLEARED on the provider's next submit. Full history lives in
//     the provider.changes_requested audit payload. `rejectedAt`/`rejectedByAdminId`
//     are deliberately NOT set — those belong to an actual rejection.
//  3. No notification is dispatched — there is no existing CHANGES_REQUESTED
//     notification kind, and none is invented here; the provider sees the status
//     and reason in-app on their verification / application pages.
//
// Reviewer identity comes ONLY from requireAdmin(); there is no client-supplied
// admin/reviewer id, and no self-approval is implied.

export type RequestProviderChangesResult = { ok: true } | { ok: false; error: ProviderAdminActionErrorCode };

const CHANGEABLE_PROVIDER_STATUSES = ["APPLIED", "UNDER_REVIEW"] as const;
const MAX_REASON_LENGTH = 2000;

export async function requestProviderChanges(providerId: string, reasonInput: string): Promise<RequestProviderChangesResult> {
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
      select: { status: true },
    });

    if (!provider) {
      return { ok: false, error: "PROVIDER_NOT_FOUND" };
    }
    if (!CHANGEABLE_PROVIDER_STATUSES.includes(provider.status as (typeof CHANGEABLE_PROVIDER_STATUSES)[number])) {
      return { ok: false, error: "PROVIDER_NOT_PENDING" };
    }

    const transitioned = await prisma.$transaction(async (tx) => {
      // Optimistic guard — only a still-submitted provider can be returned.
      const updated = await tx.provider.updateMany({
        where: { id: providerId, status: { in: [...CHANGEABLE_PROVIDER_STATUSES] } },
        data: {
          status: "CHANGES_REQUESTED",
          rejectionReason: reason, // reused as the changes reason; cleared on re-submit
        },
      });

      if (updated.count === 0) {
        return false;
      }

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "provider.changes_requested",
          entityType: "Provider",
          entityId: providerId,
          previousValue: { status: provider.status },
          // Reason retained here permanently — survives the provider's re-submit,
          // which clears Provider.rejectionReason but never touches the audit trail.
          newValue: { status: "CHANGES_REQUESTED", reason, byAdminId: admin.id },
        },
        tx
      );

      return true;
    });

    if (!transitioned) {
      return { ok: false, error: "PROVIDER_NOT_PENDING" };
    }

    return { ok: true };
  } catch (error) {
    logger.error("requestProviderChanges.unexpected_error", {
      providerId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
