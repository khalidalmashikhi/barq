"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { isValidServiceTypeKey, DEFAULT_SERVICE_TYPE_KEY, type ServiceTypeKey } from "@/lib/service-types";
import type { CategoryActionErrorCode } from "./category-errors";

// Create Category — Phase 1.1 (Core Business Platform). Mirrors
// create-service.ts's shape: "use server", requireAdmin(), server-side
// re-validation of everything, a single $transaction, a stable
// CategoryActionErrorCode-style return.
//
// A new Category always starts HIDDEN (schema default) — an admin must
// explicitly make it PUBLIC/LINK_ONLY/etc. via setCategoryVisibility, never
// implicitly on creation. slug is admin-supplied (not auto-derived from
// name) since a bilingual name has no single canonical slug source.

export type CreateCategoryResult = { ok: true; categoryId: string } | { ok: false; error: CategoryActionErrorCode };

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function createCategory(formData: FormData): Promise<CreateCategoryResult> {
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

  // ServiceType classification (ADR-0015). Every Category belongs to exactly
  // one vertical, validated against the code-owned registry (the DB CHECK
  // constraint is the second line of defense). Absent → the default vertical
  // (EXPERIENCE); present-but-invalid → rejected. The admin form's
  // serviceTypeKey <select> is wired in a later commit; until then callers
  // omit it and get the default. (Child/parentId creation arrives in the
  // tree-collapse commit — this commit only satisfies the new required field.)
  const serviceTypeKeyRaw = formData.get("serviceTypeKey");
  let serviceTypeKey: ServiceTypeKey;
  if (serviceTypeKeyRaw === null || serviceTypeKeyRaw === "") {
    serviceTypeKey = DEFAULT_SERVICE_TYPE_KEY;
  } else if (isValidServiceTypeKey(serviceTypeKeyRaw)) {
    serviceTypeKey = serviceTypeKeyRaw;
  } else {
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
    const existing = await prisma.category.findUnique({ where: { slug: trimmedSlug } });
    if (existing) {
      return { ok: false, error: "SLUG_TAKEN" };
    }

    const categoryId = await prisma.$transaction(async (tx) => {
      // The schema's sortOrder default (0) would tie every new category
      // with every other, making moveCategoryUp/Down's swap a silent
      // no-op (swapping two equal values changes nothing) — explicitly
      // append to the end of the existing order instead.
      const maxOrder = await tx.category.aggregate({ _max: { sortOrder: true } });
      const nextSortOrder = (maxOrder._max.sortOrder ?? -1) + 1;

      const category = await tx.category.create({
        data: {
          name: { ar: trimmedNameAr, en: trimmedNameEn },
          slug: trimmedSlug,
          serviceTypeKey,
          sortOrder: nextSortOrder,
        },
      });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "category.created",
          entityType: "Category",
          entityId: category.id,
          newValue: { name: { ar: trimmedNameAr, en: trimmedNameEn }, slug: trimmedSlug, serviceTypeKey, visibilityStatus: "HIDDEN" },
        },
        tx
      );

      return category.id;
    });

    return { ok: true, categoryId };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "SLUG_TAKEN" };
    }
    logger.error("createCategory.unexpected_error", {
      adminId: admin.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
