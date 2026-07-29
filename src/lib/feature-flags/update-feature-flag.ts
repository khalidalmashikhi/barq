"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { FeatureFlagActionErrorCode } from "./feature-flag-errors";

// Update Feature Flag — Phase 1.3 (Core Business Platform). Only mutates
// `description` — `key` is immutable after creation (see the schema
// comment on FeatureFlag.key: renaming it would silently break any code
// already checking the old key) and `enabled` goes through the separate
// toggle-feature-flag.ts action, mirroring Category's own separation
// between updateCategory (name/slug) and transition-category-visibility.ts.

export type UpdateFeatureFlagResult = { ok: true } | { ok: false; error: FeatureFlagActionErrorCode };

export async function updateFeatureFlag(flagId: string, formData: FormData): Promise<UpdateFeatureFlagResult> {
  if (!isValidUuid(flagId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const description = formData.get("description");

  if (typeof description !== "string") {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const trimmedDescription = description.trim();

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
    const flag = await prisma.featureFlag.findUnique({ where: { id: flagId } });

    if (!flag) {
      return { ok: false, error: "FLAG_NOT_FOUND" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.featureFlag.update({
        where: { id: flagId },
        data: { description: trimmedDescription || null },
      });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "feature_flag.updated",
          entityType: "FeatureFlag",
          entityId: flagId,
          previousValue: { description: flag.description },
          newValue: { description: trimmedDescription || null },
        },
        tx
      );
    });

    return { ok: true };
  } catch (error) {
    logger.error("updateFeatureFlag.unexpected_error", {
      flagId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
