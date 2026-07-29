"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { HomepageSectionActionErrorCode } from "./homepage-section-errors";

// Create Homepage Section — Phase 1.4 (Core Business Platform). Mirrors
// create-feature-flag.ts's shape. A new section always starts not visible
// (schema default) — an admin must explicitly show it via
// toggle-homepage-section.ts, never implicitly on creation. Backend/admin
// only: this action has no effect on the real, currently-static public
// homepage (no rendering code reads this table yet).

export type CreateHomepageSectionResult =
  | { ok: true; sectionId: string }
  | { ok: false; error: HomepageSectionActionErrorCode };

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export async function createHomepageSection(formData: FormData): Promise<CreateHomepageSectionResult> {
  const key = formData.get("key");
  const label = formData.get("label");
  const description = formData.get("description");

  if (typeof key !== "string" || typeof label !== "string" || typeof description !== "string") {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const trimmedKey = key.trim().toLowerCase();
  const trimmedLabel = label.trim();
  const trimmedDescription = description.trim();

  if (!KEY_PATTERN.test(trimmedKey) || !trimmedLabel) {
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
    const existing = await prisma.homepageSection.findUnique({ where: { key: trimmedKey } });
    if (existing) {
      return { ok: false, error: "KEY_TAKEN" };
    }

    const sectionId = await prisma.$transaction(async (tx) => {
      // The schema's sortOrder default (0) would tie every new section
      // with every other, making moveHomepageSectionUp/Down's swap a
      // silent no-op (swapping two equal values changes nothing) —
      // explicitly append to the end of the existing order instead.
      const maxOrder = await tx.homepageSection.aggregate({ _max: { sortOrder: true } });
      const nextSortOrder = (maxOrder._max.sortOrder ?? -1) + 1;

      const section = await tx.homepageSection.create({
        data: {
          key: trimmedKey,
          label: trimmedLabel,
          description: trimmedDescription || null,
          sortOrder: nextSortOrder,
        },
      });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "homepage_section.created",
          entityType: "HomepageSection",
          entityId: section.id,
          newValue: { key: trimmedKey, label: trimmedLabel, visible: false },
        },
        tx
      );

      return section.id;
    });

    return { ok: true, sectionId };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "KEY_TAKEN" };
    }
    logger.error("createHomepageSection.unexpected_error", {
      adminId: admin.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
