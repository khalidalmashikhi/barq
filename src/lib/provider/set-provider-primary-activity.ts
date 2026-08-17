"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { assertAssignableCategory } from "@/lib/categories/assert-assignable-category";
import { DEFAULT_SERVICE_TYPE_KEY } from "@/lib/service-types";
import { canProviderEditPrimaryActivity } from "./activities/activity-policy";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { logger } from "@/lib/logger";

// Gate B4 — replaces the removed multi-select setProviderCategories. A provider
// self-selects EXACTLY ONE primary activity, and may replace it ONLY while the
// application is still an unsubmitted DRAFT (canProviderEditPrimaryActivity). It:
//   - takes a SINGLE categoryId (never an array — no way to self-add a second),
//   - atomically replaces ONLY the SELF/primary row (deleteMany source=SELF +
//     create), so ADMIN and LEGACY links are never touched,
//   - never lets the provider set source/isPrimary/grantedBy* (all server-fixed).
// The B1 partial unique index guarantees at most one primary per provider.

export type SetProviderPrimaryActivityResult =
  | { ok: true }
  | { ok: false; error: "INVALID_INPUT" | "INVALID_CATEGORY" | "NO_PROVIDER_PROFILE" | "PRIMARY_LOCKED" | "UNKNOWN_ERROR" };

export async function setProviderPrimaryActivity(formData: FormData): Promise<SetProviderPrimaryActivityResult> {
  const raw = formData.get("categoryId");
  const categoryId = typeof raw === "string" ? raw.trim() : "";
  if (!categoryId) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  let provider;
  try {
    ({ provider } = await requireProvider());
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/");
    if (error instanceof ForbiddenError) return { ok: false, error: "NO_PROVIDER_PROFILE" };
    throw error;
  }

  // Primary is locked after submission/approval — self-service edit is DRAFT-only.
  if (!canProviderEditPrimaryActivity(provider.status)) {
    return { ok: false, error: "PRIMARY_LOCKED" };
  }
  if (!(await assertAssignableCategory(categoryId, DEFAULT_SERVICE_TYPE_KEY))) {
    return { ok: false, error: "INVALID_CATEGORY" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const prevPrimary = await tx.providerCategory.findFirst({
        where: { providerId: provider.id, source: "SELF", isPrimary: true },
        select: { categoryId: true },
      });
      if (prevPrimary?.categoryId === categoryId) return; // unchanged → no-op

      // Replace ONLY the SELF primary — ADMIN/LEGACY rows are never deleted here.
      await tx.providerCategory.deleteMany({ where: { providerId: provider.id, source: "SELF" } });
      await tx.providerCategory.create({
        data: { providerId: provider.id, categoryId, source: "SELF", isPrimary: true },
      });
      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: provider.id,
          action: "provider.primary_activity_changed",
          entityType: "Provider",
          entityId: provider.id,
          previousValue: { categoryId: prevPrimary?.categoryId ?? null },
          newValue: { categoryId },
        },
        tx
      );
    });

    revalidatePath("/provider/settings");
    return { ok: true };
  } catch (error) {
    logger.error("setProviderPrimaryActivity.unexpected_error", {
      providerId: provider.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
