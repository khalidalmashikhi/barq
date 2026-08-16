"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { ProviderApplicationErrorCode } from "./provider-application-errors";

// Resubmit provider application — Provider Review / Reject / Resubmit lifecycle.
// A PROVIDER SELF-ACTION: the provider identity comes exclusively from
// requireProvider() (never a URL/client-supplied id), so a provider can only
// ever resubmit their OWN application. REJECTED is "active" for
// resolveProviderStatus(), so requireProvider() admits a rejected provider
// (exactly like APPLIED) — no RBAC change is needed.
//
// Gate 1A: transition REJECTED -> DRAFT (was APPLIED), via an OPTIMISTIC
// conditional guard (updateMany WHERE status = REJECTED) so a stale/concurrent
// action (e.g. an admin archiving the provider, or a double submit) matches 0
// rows and is reported as NOT_REJECTED rather than silently overwriting another
// state. Returning to DRAFT (not straight back to the queue) makes the provider
// edit their documents and then EXPLICITLY re-submit — consistent with the new
// "upload is not submission" rule.
// Resubmission CLEARS the current rejection fields (rejectionReason/rejectedAt/
// rejectedByAdminId) — the full history remains in the AuditLog
// (provider.rejected). `visible` is deliberately never touched, and no new
// Provider row is created. No notification is sent for resubmission.

export type ResubmitProviderApplicationResult = { ok: true } | { ok: false; error: ProviderApplicationErrorCode };

export async function resubmitProviderApplication(): Promise<ResubmitProviderApplicationResult> {
  let provider;
  try {
    const auth = await requireProvider();
    provider = auth.provider;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/");
    }
    if (error instanceof ForbiddenError) {
      // Not a provider, or SUSPENDED/DEACTIVATED — not resubmittable.
      return { ok: false, error: "NOT_REJECTED" };
    }
    throw error;
  }

  try {
    const transitioned = await prisma.$transaction(async (tx) => {
      const updated = await tx.provider.updateMany({
        where: { id: provider.id, status: "REJECTED" },
        data: {
          status: "DRAFT",
          rejectionReason: null,
          rejectedAt: null,
          rejectedByAdminId: null,
        },
      });

      if (updated.count === 0) {
        return false;
      }

      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: provider.id,
          action: "provider.resubmitted",
          entityType: "Provider",
          entityId: provider.id,
          previousValue: { status: "REJECTED" },
          newValue: { status: "DRAFT" },
        },
        tx
      );

      return true;
    });

    if (!transitioned) {
      // Not currently REJECTED (stale/concurrent) — nothing was changed.
      return { ok: false, error: "NOT_REJECTED" };
    }

    return { ok: true };
  } catch (error) {
    logger.error("resubmitProviderApplication.unexpected_error", {
      providerId: provider.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
