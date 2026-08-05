"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { CategoryVisibilityStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { canTransitionCategoryVisibility, isValidScheduledVisibility } from "./category-visibility-policy";
import type { CategoryActionErrorCode } from "./category-errors";

// Category visibility transitions — Phase 1.1 (Core Business Platform).
// Mirrors transition-service-status.ts's shape: a generic, policy-matrix-
// validated setCategoryVisibility() for any of BR-004's 6 states, plus a
// named archiveCategory() convenience wrapper for the single most common
// one-off admin action — both built on the same shared internals, no
// duplicated logic between them.

export type TransitionCategoryVisibilityResult = { ok: true } | { ok: false; error: CategoryActionErrorCode };

async function transition(
  categoryId: string,
  targetStatus: CategoryVisibilityStatus,
  scheduledVisibleAt: Date | null
): Promise<TransitionCategoryVisibilityResult> {
  if (!isValidUuid(categoryId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  if (targetStatus === "SCHEDULED" && !isValidScheduledVisibility(scheduledVisibleAt)) {
    return { ok: false, error: "INVALID_SCHEDULED_DATE" };
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
    const category = await prisma.category.findUnique({ where: { id: categoryId } });

    if (!category) {
      return { ok: false, error: "CATEGORY_NOT_FOUND" };
    }

    if (!canTransitionCategoryVisibility(category.visibilityStatus, targetStatus)) {
      return { ok: false, error: "INVALID_VISIBILITY_TRANSITION" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.category.update({
        where: { id: categoryId },
        data: {
          visibilityStatus: targetStatus,
          scheduledVisibleAt: targetStatus === "SCHEDULED" ? scheduledVisibleAt : null,
        },
      });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "category.visibility_changed",
          entityType: "Category",
          entityId: categoryId,
          previousValue: { visibilityStatus: category.visibilityStatus },
          newValue: { visibilityStatus: targetStatus },
        },
        tx
      );
    });

    return { ok: true };
  } catch (error) {
    logger.error("setCategoryVisibility.unexpected_error", {
      categoryId,
      targetStatus,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}

export async function setCategoryVisibility(
  categoryId: string,
  targetStatus: CategoryVisibilityStatus,
  scheduledVisibleAt?: Date
): Promise<TransitionCategoryVisibilityResult> {
  return transition(categoryId, targetStatus, scheduledVisibleAt ?? null);
}

export async function archiveCategory(categoryId: string): Promise<TransitionCategoryVisibilityResult> {
  return transition(categoryId, "ARCHIVED", null);
}

// Restore an ARCHIVED category — a named convenience wrapper mirroring
// archiveCategory(), so the admin has a clear one-click action instead of
// hunting through the visibility selector. Reuses the same transition()
// internals (visibility state machine, requireAdmin RBAC, in-transaction audit
// log) — no new state, no schema change. Restores to PUBLIC by default; pass
// "HIDDEN" for the "restore as hidden" secondary action. On success it
// revalidates the admin category list and this category's detail so both
// refresh immediately (the visibility state change is invisible to callers
// beyond that — same result shape as the other transition actions).
export async function restoreCategory(
  categoryId: string,
  target: "PUBLIC" | "HIDDEN" = "PUBLIC"
): Promise<TransitionCategoryVisibilityResult> {
  const result = await transition(categoryId, target, null);
  if (result.ok) {
    revalidatePath("/admin/categories");
    revalidatePath(`/admin/categories/${categoryId}`);
  }
  return result;
}
