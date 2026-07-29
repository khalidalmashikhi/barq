"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { HomepageSectionActionErrorCode } from "./homepage-section-errors";

// Show/hide a Homepage Section — Phase 1.4 (Core Business Platform).
// Mirrors toggle-feature-flag.ts exactly: a plain boolean flip, no
// transition matrix — this phase's scope is a simple visible/not-visible
// switch, not a multi-state visibility lifecycle like Category's BR-004
// (no scheduling/link-only/invite-only concept was requested for homepage
// sections). Toggling here has no effect on the real public homepage yet
// — no rendering code reads this table.

export type ToggleHomepageSectionResult = { ok: true } | { ok: false; error: HomepageSectionActionErrorCode };

async function setVisible(sectionId: string, visible: boolean): Promise<ToggleHomepageSectionResult> {
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
    const section = await prisma.homepageSection.findUnique({ where: { id: sectionId } });

    if (!section) {
      return { ok: false, error: "SECTION_NOT_FOUND" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.homepageSection.update({ where: { id: sectionId }, data: { visible } });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: visible ? "homepage_section.shown" : "homepage_section.hidden",
          entityType: "HomepageSection",
          entityId: sectionId,
          previousValue: { visible: section.visible },
          newValue: { visible },
        },
        tx
      );
    });

    return { ok: true };
  } catch (error) {
    logger.error("toggleHomepageSection.unexpected_error", {
      sectionId,
      visible,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}

export async function showHomepageSection(sectionId: string): Promise<ToggleHomepageSectionResult> {
  return setVisible(sectionId, true);
}

export async function hideHomepageSection(sectionId: string): Promise<ToggleHomepageSectionResult> {
  return setVisible(sectionId, false);
}
