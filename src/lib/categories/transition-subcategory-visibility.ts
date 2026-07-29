"use server";

import { redirect } from "next/navigation";
import type { CategoryVisibilityStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { canTransitionCategoryVisibility, isValidScheduledVisibility } from "./category-visibility-policy";
import type { CategoryActionErrorCode } from "./category-errors";

// SubCategory visibility transitions — Phase 1.1 (Core Business Platform).
// Reuses the same 6-state transition matrix as Category (canTransitionCategoryVisibility)
// rather than a duplicated SubCategory-specific one — the states and their
// graph are identical, per BR-004; only the effective-visibility read
// (isSubCategoryEffectivelyVisible, consulted at query time, not here) differs.

export type TransitionSubCategoryVisibilityResult = { ok: true } | { ok: false; error: CategoryActionErrorCode };

async function transition(
  subCategoryId: string,
  targetStatus: CategoryVisibilityStatus,
  scheduledVisibleAt: Date | null
): Promise<TransitionSubCategoryVisibilityResult> {
  if (!isValidUuid(subCategoryId)) {
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
    const subCategory = await prisma.subCategory.findUnique({ where: { id: subCategoryId } });

    if (!subCategory) {
      return { ok: false, error: "SUBCATEGORY_NOT_FOUND" };
    }

    if (!canTransitionCategoryVisibility(subCategory.visibilityStatus, targetStatus)) {
      return { ok: false, error: "INVALID_VISIBILITY_TRANSITION" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.subCategory.update({
        where: { id: subCategoryId },
        data: {
          visibilityStatus: targetStatus,
          scheduledVisibleAt: targetStatus === "SCHEDULED" ? scheduledVisibleAt : null,
        },
      });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "subcategory.visibility_changed",
          entityType: "SubCategory",
          entityId: subCategoryId,
          previousValue: { visibilityStatus: subCategory.visibilityStatus },
          newValue: { visibilityStatus: targetStatus },
        },
        tx
      );
    });

    return { ok: true };
  } catch (error) {
    logger.error("setSubCategoryVisibility.unexpected_error", {
      subCategoryId,
      targetStatus,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}

export async function setSubCategoryVisibility(
  subCategoryId: string,
  targetStatus: CategoryVisibilityStatus,
  scheduledVisibleAt?: Date
): Promise<TransitionSubCategoryVisibilityResult> {
  return transition(subCategoryId, targetStatus, scheduledVisibleAt ?? null);
}

export async function archiveSubCategory(subCategoryId: string): Promise<TransitionSubCategoryVisibilityResult> {
  return transition(subCategoryId, "ARCHIVED", null);
}
