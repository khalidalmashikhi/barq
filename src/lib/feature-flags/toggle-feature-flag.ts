"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { FeatureFlagActionErrorCode } from "./feature-flag-errors";

// Enable/disable a Feature Flag — Phase 1.3 (Core Business Platform).
// Deliberately a plain boolean flip, no transition matrix needed (unlike
// Category's 6-state visibility) — this phase's own scope is explicitly
// "global on/off only," so there is no state graph to validate against.

export type ToggleFeatureFlagResult = { ok: true } | { ok: false; error: FeatureFlagActionErrorCode };

async function setEnabled(flagId: string, enabled: boolean): Promise<ToggleFeatureFlagResult> {
  if (!isValidUuid(flagId)) {
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
    const flag = await prisma.featureFlag.findUnique({ where: { id: flagId } });

    if (!flag) {
      return { ok: false, error: "FLAG_NOT_FOUND" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.featureFlag.update({ where: { id: flagId }, data: { enabled } });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: enabled ? "feature_flag.enabled" : "feature_flag.disabled",
          entityType: "FeatureFlag",
          entityId: flagId,
          previousValue: { enabled: flag.enabled },
          newValue: { enabled },
        },
        tx
      );
    });

    return { ok: true };
  } catch (error) {
    logger.error("toggleFeatureFlag.unexpected_error", {
      flagId,
      enabled,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}

export async function enableFeatureFlag(flagId: string): Promise<ToggleFeatureFlagResult> {
  return setEnabled(flagId, true);
}

export async function disableFeatureFlag(flagId: string): Promise<ToggleFeatureFlagResult> {
  return setEnabled(flagId, false);
}
