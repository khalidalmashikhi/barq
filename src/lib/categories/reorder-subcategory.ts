"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { CategoryActionErrorCode } from "./category-errors";

// SubCategory ordering — Phase 1.2 (Category Admin UI) prerequisite.
// Mirrors reorder-category.ts exactly, scoped to siblings under the same
// parent Category (a SubCategory only ever moves relative to its own
// parent's other children, never across categories).

export type ReorderSubCategoryResult = { ok: true } | { ok: false; error: CategoryActionErrorCode };

async function move(subCategoryId: string, direction: "up" | "down"): Promise<ReorderSubCategoryResult> {
  if (!isValidUuid(subCategoryId)) {
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
    const target = await prisma.subCategory.findUnique({ where: { id: subCategoryId } });
    if (!target) {
      return { ok: false, error: "SUBCATEGORY_NOT_FOUND" };
    }

    const siblings = await prisma.subCategory.findMany({
      where: { categoryId: target.categoryId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, sortOrder: true },
    });

    const index = siblings.findIndex((s) => s.id === subCategoryId);
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= siblings.length) {
      return { ok: true };
    }

    const current = siblings[index];
    const neighbor = siblings[swapIndex];
    if (!current || !neighbor) {
      return { ok: false, error: "SUBCATEGORY_NOT_FOUND" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.subCategory.update({ where: { id: current.id }, data: { sortOrder: neighbor.sortOrder } });
      await tx.subCategory.update({ where: { id: neighbor.id }, data: { sortOrder: current.sortOrder } });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "subcategory.reordered",
          entityType: "SubCategory",
          entityId: current.id,
          previousValue: { sortOrder: current.sortOrder },
          newValue: { sortOrder: neighbor.sortOrder },
        },
        tx
      );
    });

    return { ok: true };
  } catch (error) {
    logger.error("reorderSubCategory.unexpected_error", {
      subCategoryId,
      direction,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}

export async function moveSubCategoryUp(subCategoryId: string): Promise<ReorderSubCategoryResult> {
  return move(subCategoryId, "up");
}

export async function moveSubCategoryDown(subCategoryId: string): Promise<ReorderSubCategoryResult> {
  return move(subCategoryId, "down");
}
