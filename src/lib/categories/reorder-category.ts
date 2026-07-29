"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { CategoryActionErrorCode } from "./category-errors";

// Category ordering — Phase 1.2 (Category Admin UI) prerequisite.
//
// WHY THIS EXISTS HERE, NOT IN PHASE 1.1: Phase 1.1 added `sortOrder` to
// the schema (default 0) but never exposed a way to change it — no UI
// existed yet to need one. Phase 1.2's own scope explicitly names
// "Ordering" as a required admin capability, so this closes that gap now,
// following the exact same requireAdmin()/audit-log/error-code pattern as
// every other Category action — not a redesign, not a bug fix, just the
// one piece of Phase 1.1's own schema that had no write path yet.
//
// SWAP, NOT A NUMERIC REORDER FIELD: moves a Category exactly one position
// up or down relative to its current sortOrder/createdAt ordering (the same
// ordering get-categories.ts already uses) by swapping sortOrder with the
// adjacent sibling — simpler and less error-prone for an admin UI than
// asking for a raw numeric position, and needs no drag-and-drop client code.

export type ReorderCategoryResult = { ok: true } | { ok: false; error: CategoryActionErrorCode };

async function move(categoryId: string, direction: "up" | "down"): Promise<ReorderCategoryResult> {
  if (!isValidUuid(categoryId)) {
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
    const ordered = await prisma.category.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, sortOrder: true },
    });

    const index = ordered.findIndex((c) => c.id === categoryId);
    if (index === -1) {
      return { ok: false, error: "CATEGORY_NOT_FOUND" };
    }

    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= ordered.length) {
      // Already at the boundary — a no-op, not an error; the UI simply
      // disables the button at this edge.
      return { ok: true };
    }

    const current = ordered[index];
    const neighbor = ordered[swapIndex];
    if (!current || !neighbor) {
      return { ok: false, error: "CATEGORY_NOT_FOUND" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.category.update({ where: { id: current.id }, data: { sortOrder: neighbor.sortOrder } });
      await tx.category.update({ where: { id: neighbor.id }, data: { sortOrder: current.sortOrder } });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "category.reordered",
          entityType: "Category",
          entityId: current.id,
          previousValue: { sortOrder: current.sortOrder },
          newValue: { sortOrder: neighbor.sortOrder },
        },
        tx
      );
    });

    return { ok: true };
  } catch (error) {
    logger.error("reorderCategory.unexpected_error", {
      categoryId,
      direction,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}

export async function moveCategoryUp(categoryId: string): Promise<ReorderCategoryResult> {
  return move(categoryId, "up");
}

export async function moveCategoryDown(categoryId: string): Promise<ReorderCategoryResult> {
  return move(categoryId, "down");
}
