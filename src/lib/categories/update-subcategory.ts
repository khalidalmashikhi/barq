"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { CategoryActionErrorCode } from "./category-errors";

// Update SubCategory — Phase 1.1 (Core Business Platform). Mirrors
// update-category.ts's shape. Only mutates name/slug — visibility changes
// go through transition-subcategory-visibility.ts. Deliberately does not
// allow moving a SubCategory to a different parent Category in this phase
// — no requirement named it, and it would need its own uniqueness/ordering
// reasoning not otherwise needed here.

export type UpdateSubCategoryResult = { ok: true } | { ok: false; error: CategoryActionErrorCode };

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function updateSubCategory(subCategoryId: string, formData: FormData): Promise<UpdateSubCategoryResult> {
  if (!isValidUuid(subCategoryId)) {
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
    const subCategory = await prisma.subCategory.findUnique({ where: { id: subCategoryId } });

    if (!subCategory) {
      return { ok: false, error: "SUBCATEGORY_NOT_FOUND" };
    }

    if (trimmedSlug !== subCategory.slug) {
      const slugOwner = await prisma.subCategory.findUnique({ where: { slug: trimmedSlug } });
      if (slugOwner) {
        return { ok: false, error: "SLUG_TAKEN" };
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.subCategory.update({
        where: { id: subCategoryId },
        data: { name: { ar: trimmedNameAr, en: trimmedNameEn }, slug: trimmedSlug },
      });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "subcategory.updated",
          entityType: "SubCategory",
          entityId: subCategoryId,
          previousValue: { name: subCategory.name as object, slug: subCategory.slug },
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
    logger.error("updateSubCategory.unexpected_error", {
      subCategoryId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
