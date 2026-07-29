"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { FeatureFlagActionErrorCode } from "./feature-flag-errors";

// Create Feature Flag — Phase 1.3 (Core Business Platform). Mirrors
// create-category.ts's shape: "use server", requireAdmin(), server-side
// re-validation, a single $transaction, a stable
// FeatureFlagActionErrorCode-style return.
//
// A new flag always starts disabled (schema default) — an admin must
// explicitly enable it via toggleFeatureFlag, never implicitly on creation.

export type CreateFeatureFlagResult = { ok: true; flagId: string } | { ok: false; error: FeatureFlagActionErrorCode };

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export async function createFeatureFlag(formData: FormData): Promise<CreateFeatureFlagResult> {
  const key = formData.get("key");
  const description = formData.get("description");

  if (typeof key !== "string" || typeof description !== "string") {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const trimmedKey = key.trim().toLowerCase();
  const trimmedDescription = description.trim();

  if (!KEY_PATTERN.test(trimmedKey)) {
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
    const existing = await prisma.featureFlag.findUnique({ where: { key: trimmedKey } });
    if (existing) {
      return { ok: false, error: "KEY_TAKEN" };
    }

    const flagId = await prisma.$transaction(async (tx) => {
      const flag = await tx.featureFlag.create({
        data: {
          key: trimmedKey,
          description: trimmedDescription || null,
        },
      });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "feature_flag.created",
          entityType: "FeatureFlag",
          entityId: flag.id,
          newValue: { key: trimmedKey, enabled: false, description: trimmedDescription || null },
        },
        tx
      );

      return flag.id;
    });

    return { ok: true, flagId };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "KEY_TAKEN" };
    }
    logger.error("createFeatureFlag.unexpected_error", {
      adminId: admin.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
