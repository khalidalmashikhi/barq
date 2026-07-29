"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { CategoryActionErrorCode } from "./category-errors";

// Create SubCategory — Phase 1.1 (Core Business Platform). Mirrors
// create-category.ts's shape, with an added parent-existence check (a
// SubCategory cannot exist without its parent Category).

export type CreateSubCategoryResult = { ok: true; subCategoryId: string } | { ok: false; error: CategoryActionErrorCode };

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function createSubCategory(categoryId: string, formData: FormData): Promise<CreateSubCategoryResult> {
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

    const existingSlug = await prisma.subCategory.findUnique({ where: { slug: trimmedSlug } });
    if (existingSlug) {
      return { ok: false, error: "SLUG_TAKEN" };
    }

    const subCategoryId = await prisma.$transaction(async (tx) => {
      // The schema's sortOrder default (0) would tie every new
      // subcategory with its siblings under the same parent, making
      // moveSubCategoryUp/Down's swap a silent no-op (swapping two equal
      // values changes nothing) — explicitly append to the end of the
      // existing sibling order instead.
      const maxOrder = await tx.subCategory.aggregate({ where: { categoryId }, _max: { sortOrder: true } });
      const nextSortOrder = (maxOrder._max.sortOrder ?? -1) + 1;

      const subCategory = await tx.subCategory.create({
        data: {
          categoryId,
          name: { ar: trimmedNameAr, en: trimmedNameEn },
          slug: trimmedSlug,
          sortOrder: nextSortOrder,
        },
      });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "subcategory.created",
          entityType: "SubCategory",
          entityId: subCategory.id,
          newValue: {
            categoryId,
            name: { ar: trimmedNameAr, en: trimmedNameEn },
            slug: trimmedSlug,
            visibilityStatus: "HIDDEN",
          },
        },
        tx
      );

      return subCategory.id;
    });

    return { ok: true, subCategoryId };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "SLUG_TAKEN" };
    }
    logger.error("createSubCategory.unexpected_error", {
      categoryId,
      adminId: admin.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
