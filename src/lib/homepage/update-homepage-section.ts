"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { HomepageSectionActionErrorCode } from "./homepage-section-errors";

// Update Homepage Section — Phase 1.4 (Core Business Platform). Only
// mutates `label`/`description` — `key` is immutable after creation (see
// the schema comment: a future rendering phase will match against it) and
// `visible` goes through the separate toggle-homepage-section.ts action,
// mirroring Category/Feature Flag's own separation.

export type UpdateHomepageSectionResult = { ok: true } | { ok: false; error: HomepageSectionActionErrorCode };

export async function updateHomepageSection(sectionId: string, formData: FormData): Promise<UpdateHomepageSectionResult> {
  if (!isValidUuid(sectionId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const label = formData.get("label");
  const description = formData.get("description");

  if (typeof label !== "string" || typeof description !== "string") {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const trimmedLabel = label.trim();
  const trimmedDescription = description.trim();

  if (!trimmedLabel) {
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
      await tx.homepageSection.update({
        where: { id: sectionId },
        data: { label: trimmedLabel, description: trimmedDescription || null },
      });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "homepage_section.updated",
          entityType: "HomepageSection",
          entityId: sectionId,
          previousValue: { label: section.label, description: section.description },
          newValue: { label: trimmedLabel, description: trimmedDescription || null },
        },
        tx
      );
    });

    return { ok: true };
  } catch (error) {
    logger.error("updateHomepageSection.unexpected_error", {
      sectionId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
