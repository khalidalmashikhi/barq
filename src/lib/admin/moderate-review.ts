"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import {
  isReviewModerationAction,
  resolveModerationTransition,
  moderationAuditAction,
} from "./review-moderation-policy";
import type { ReviewAdminActionErrorCode } from "./review-admin-errors";

// REVIEW TRUST & SAFETY — the admin moderation action. Mirrors suspend-provider.ts's exact shape:
// uuid validation → requireAdmin() try/catch → server-side resource resolution → policy guard →
// transactional guarded-update + audit. Moderation changes public VISIBILITY only (moderationState);
// the Review row's rating/comment/linkages/timestamps are never touched — the review stays an
// auditable record (NEVER a hard delete). All public/aggregate surfaces already filter
// moderationState:"PUBLISHED", so flagging/removing hides a review everywhere public and drops it
// from rating averages/counts with no query change here.
//
// AUTHORITY: gated on the single requireAdmin() (BARQ has no narrower admin capability). A customer/
// provider/non-admin can never reach this. IDOR-safe: the review is resolved server-side by id only;
// providerId/customerId/serviceId are never trusted from the request. CONCURRENCY: a guarded
// updateMany({ where:{ id, moderationState: current } }) means two moderators racing cannot both
// win — the loser matches 0 rows and gets MODERATION_CONFLICT (re-read + retry), never a silent
// overwrite of a stale state.

export type ModerateReviewResult = { ok: true } | { ok: false; error: ReviewAdminActionErrorCode };

const REASON_MAX = 500;

export async function moderateReview(reviewId: string, formData: FormData): Promise<ModerateReviewResult> {
  if (!isValidUuid(reviewId)) return { ok: false, error: "INVALID_INPUT" };

  const rawAction = formData.get("action");
  if (!isReviewModerationAction(rawAction)) return { ok: false, error: "INVALID_INPUT" };
  const action = rawAction;

  // Optional short admin reason — trimmed, bounded, stored only in the AuditLog newValue JSON (no
  // schema, no Review column). Empty → omitted. Over the cap → rejected (never silently truncated).
  const rawReason = formData.get("reason");
  const reason = typeof rawReason === "string" ? rawReason.trim() : "";
  if (reason.length > REASON_MAX) return { ok: false, error: "INVALID_INPUT" };

  let admin;
  try {
    const auth = await requireAdmin();
    admin = auth.admin;
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/");
    if (error instanceof ForbiddenError) return { ok: false, error: "NO_ADMIN_PROFILE" };
    throw error;
  }

  try {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true, moderationState: true },
    });
    if (!review) return { ok: false, error: "REVIEW_NOT_FOUND" };

    const transition = resolveModerationTransition(review.moderationState, action);
    if (!transition.ok) return { ok: false, error: "INVALID_TRANSITION" };
    const target = transition.target;

    const conflict = await prisma.$transaction(async (tx) => {
      // Guarded write: only succeeds while the review is STILL in the state we validated against.
      const updated = await tx.review.updateMany({
        where: { id: reviewId, moderationState: review.moderationState },
        data: { moderationState: target },
      });
      if (updated.count === 0) return true; // lost the race — abort without an audit row

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: moderationAuditAction(action),
          entityType: "Review",
          entityId: reviewId,
          // Only the moderation state changes; the review content is never copied into the audit
          // trail (it lives on the immutable Review row). Reason is safe admin-authored metadata.
          previousValue: { moderationState: review.moderationState },
          newValue: { moderationState: target, ...(reason ? { reason } : {}) },
        },
        tx,
      );
      return false;
    });

    if (conflict) return { ok: false, error: "MODERATION_CONFLICT" };
    return { ok: true };
  } catch (error) {
    logger.error("moderateReview.unexpected_error", {
      reviewId,
      action,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
