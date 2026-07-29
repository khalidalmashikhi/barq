"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { CategoryActionErrorCode } from "./category-errors";

// Update Category — Phase 1.1 (Core Business Platform). Mirrors
// update-service.ts's shape. Only mutates name/slug — visibility changes go
// through the separate transition-category-visibility.ts actions, mirroring
// Service's own separation between updateService and
// transition-service-status.ts.

export type UpdateCategoryResult = { ok: true } | { ok: false; error: CategoryActionErrorCode };

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function updateCategory(categoryId: string, formData: FormData): Promise<UpdateCategoryResult> {
  if (!isValidUuid(categoryId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const nameAr = formData.get("nameAr");
  const nameEn = formData.get("nameEn");
  const slug = formData.get("slug");

  if (typeof nameAr !== "string" || typeof nameEn !== "string" || typeof slug !== "string") {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const trimmedNameAr = nameAr.trim();
  const trimmedNameEn = nameEn.trim();
  const trimmedSlug = slug.trim().toLowerCase();

  if (!trimmedNameAr || !trimmedNameEn || !SLUG_PATTERN.test(trimmedSlug)) {
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
    const category = await prisma.category.findUnique({ where: { id: categoryId } });

    if (!category) {
      return { ok: false, error: "CATEGORY_NOT_FOUND" };
    }

    if (trimmedSlug !== category.slug) {
      const slugOwner = await prisma.category.findUnique({ where: { slug: trimmedSlug } });
      if (slugOwner) {
        return { ok: false, error: "SLUG_TAKEN" };
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.category.update({
        where: { id: categoryId },
        data: { name: { ar: trimmedNameAr, en: trimmedNameEn }, slug: trimmedSlug },
      });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "category.updated",
          entityType: "Category",
          entityId: categoryId,
          previousValue: { name: category.name as object, slug: category.slug },
          newValue: { name: { ar: trimmedNameAr, en: trimmedNameEn }, slug: trimmedSlug },
        },
        tx
      );
    });

    return { ok: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "SLUG_TAKEN" };
    }
    logger.error("updateCategory.unexpected_error", {
      categoryId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
