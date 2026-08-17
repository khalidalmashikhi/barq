"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { assertAssignableCategory } from "@/lib/categories/assert-assignable-category";
import { DEFAULT_SERVICE_TYPE_KEY } from "@/lib/service-types";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { logger } from "@/lib/logger";

// Provider "areas of activity" write (Gap G, BR-025). Replaces the provider's
// ProviderCategory set from a multi-select. Every submitted id is re-validated
// server-side against the SAME shared taxonomy rule the service picker uses
// (assertAssignableCategory: effectively-PUBLIC + serviceType-compatible) — the
// client only ever offers eligible categories, but the ids are untrusted. The
// set is replaced (deleteMany + createMany) and audited atomically (BR-019), so
// a provider can return later and change their selections idempotently.

export type SetProviderCategoriesResult =
  | { ok: true }
  | { ok: false; error: "INVALID_INPUT" | "INVALID_CATEGORY" | "NO_PROVIDER_PROFILE" | "PROVIDER_NOT_APPROVED" | "UNKNOWN_ERROR" };

const MAX_PROVIDER_CATEGORIES = 20;

export async function setProviderCategories(formData: FormData): Promise<SetProviderCategoriesResult> {
  const submitted = formData
    .getAll("categoryIds")
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
  const categoryIds = [...new Set(submitted)];

  if (categoryIds.length > MAX_PROVIDER_CATEGORIES) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  let provider;
  try {
    ({ provider } = await requireProvider());
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/");
    }
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "NO_PROVIDER_PROFILE" };
    }
    throw error;
  }

  // Re-validate every submitted id against the shared eligibility rule.
  for (const categoryId of categoryIds) {
    if (!(await assertAssignableCategory(categoryId, DEFAULT_SERVICE_TYPE_KEY))) {
      return { ok: false, error: "INVALID_CATEGORY" };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.providerCategory.findMany({
        where: { providerId: provider.id },
        select: { categoryId: true },
      });
      const previousIds = existing.map((row) => row.categoryId);

      await tx.providerCategory.deleteMany({ where: { providerId: provider.id } });
      if (categoryIds.length > 0) {
        // Gate B1: ProviderCategory.source is now a required, no-default column.
        // These are provider self-selections, so source = SELF — minimal write-compat
        // glue only. This deprecated multi-select replace path is reworked to the
        // single-primary model in B4; nothing reads source/isPrimary yet.
        await tx.providerCategory.createMany({
          data: categoryIds.map((categoryId) => ({ providerId: provider.id, categoryId, source: "SELF" as const })),
        });
      }

      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: provider.id,
          action: "provider.categories_changed",
          entityType: "Provider",
          entityId: provider.id,
          previousValue: { categoryIds: previousIds },
          newValue: { categoryIds },
        },
        tx
      );
    });

    revalidatePath("/provider/settings");
    return { ok: true };
  } catch (error) {
    logger.error("setProviderCategories.unexpected_error", {
      providerId: provider.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
