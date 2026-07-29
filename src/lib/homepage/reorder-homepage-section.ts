"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { HomepageSectionActionErrorCode } from "./homepage-section-errors";

// Homepage Section ordering — Phase 1.4 (Core Business Platform). Mirrors
// reorder-category.ts exactly: moves a section exactly one position
// up/down relative to its current sortOrder/createdAt ordering by
// swapping sortOrder with the adjacent sibling — no drag-and-drop, per
// this phase's explicit scope.

export type ReorderHomepageSectionResult = { ok: true } | { ok: false; error: HomepageSectionActionErrorCode };

async function move(sectionId: string, direction: "up" | "down"): Promise<ReorderHomepageSectionResult> {
  if (!isValidUuid(sectionId)) {
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
    const ordered = await prisma.homepageSection.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, sortOrder: true },
    });

    const index = ordered.findIndex((s) => s.id === sectionId);
    if (index === -1) {
      return { ok: false, error: "SECTION_NOT_FOUND" };
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
      return { ok: false, error: "SECTION_NOT_FOUND" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.homepageSection.update({ where: { id: current.id }, data: { sortOrder: neighbor.sortOrder } });
      await tx.homepageSection.update({ where: { id: neighbor.id }, data: { sortOrder: current.sortOrder } });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "homepage_section.reordered",
          entityType: "HomepageSection",
          entityId: current.id,
          previousValue: { sortOrder: current.sortOrder },
          newValue: { sortOrder: neighbor.sortOrder },
        },
        tx
      );
    });

    return { ok: true };
  } catch (error) {
    logger.error("reorderHomepageSection.unexpected_error", {
      sectionId,
      direction,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}

export async function moveHomepageSectionUp(sectionId: string): Promise<ReorderHomepageSectionResult> {
  return move(sectionId, "up");
}

export async function moveHomepageSectionDown(sectionId: string): Promise<ReorderHomepageSectionResult> {
  return move(sectionId, "down");
}
