"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { isValidServiceTypeKey, DEFAULT_SERVICE_TYPE_KEY, type ServiceTypeKey } from "@/lib/service-types";
import { MAX_CATEGORY_DEPTH } from "./category-tree";
import type { CategoryActionErrorCode } from "./category-errors";

// Create Category — Phase 1.1, extended for the self-referential tree
// (ADR-0015, P1). THE SINGLE creation action for both root categories and
// child categories ("sub-categories" are just depth-1 children) — there is no
// parallel child-specific action. A `parentId` in the form makes it a child;
// its absence makes it a root.
//
// A new Category always starts HIDDEN (schema default) — an admin must
// explicitly make it PUBLIC/LINK_ONLY/etc. via setCategoryVisibility, never
// implicitly on creation. slug is admin-supplied (globally unique across the
// whole tree) since a bilingual name has no single canonical slug source.

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

  // Optional parentId — present → create a child under it; absent → a root.
  const parentIdRaw = formData.get("parentId");
  const parentId = typeof parentIdRaw === "string" && parentIdRaw.trim() !== "" ? parentIdRaw.trim() : null;
  if (parentId !== null && !isValidUuid(parentId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  // Requested serviceTypeKey (ADR-0015). For a ROOT it selects the vertical
  // (absent → default EXPERIENCE). For a CHILD the vertical is always
  // inherited from the parent; a present value is only accepted if it matches
  // the parent's (a child can never belong to a different vertical — BR-023).
  // Present-but-invalid is always rejected. The DB CHECK constraint is the
  // second line of defense.
  const serviceTypeKeyRaw = formData.get("serviceTypeKey");
  let requestedServiceTypeKey: ServiceTypeKey | null;
  if (serviceTypeKeyRaw === null || serviceTypeKeyRaw === "") {
    requestedServiceTypeKey = null;
  } else if (isValidServiceTypeKey(serviceTypeKeyRaw)) {
    requestedServiceTypeKey = serviceTypeKeyRaw;
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

    // Resolve the vertical + depth from the parent (child) or the request (root).
    let serviceTypeKey: ServiceTypeKey;
    let depth: number;
    if (parentId !== null) {
      const parent = await prisma.category.findUnique({
        where: { id: parentId },
        select: { depth: true, serviceTypeKey: true },
      });
      if (!parent) {
        return { ok: false, error: "PARENT_NOT_FOUND" };
      }
      // Defensive: the DB CHECK guarantees a stored serviceTypeKey is valid.
      if (!isValidServiceTypeKey(parent.serviceTypeKey)) {
        return { ok: false, error: "UNKNOWN_ERROR" };
      }
      if (requestedServiceTypeKey !== null && requestedServiceTypeKey !== parent.serviceTypeKey) {
        return { ok: false, error: "INVALID_INPUT" };
      }
      serviceTypeKey = parent.serviceTypeKey;
      depth = parent.depth + 1;
    } else {
      serviceTypeKey = requestedServiceTypeKey ?? DEFAULT_SERVICE_TYPE_KEY;
      depth = 0;
    }

    if (depth >= MAX_CATEGORY_DEPTH) {
      return { ok: false, error: "DEPTH_EXCEEDED" };
    }

    const categoryId = await prisma.$transaction(async (tx) => {
      // Append to the end of the SIBLING order — scoped by parentId, so root
      // and child ordering never mix (swapping equal sortOrders would be a
      // silent no-op, hence the explicit append). `where: { parentId }` with a
      // null parentId matches roots only; with a uuid it matches that parent's
      // children only.
      const maxOrder = await tx.category.aggregate({ where: { parentId }, _max: { sortOrder: true } });
      const nextSortOrder = (maxOrder._max.sortOrder ?? -1) + 1;

      const category = await tx.category.create({
        data: {
          name: { ar: trimmedNameAr, en: trimmedNameEn },
          slug: trimmedSlug,
          serviceTypeKey,
          parentId,
          depth,
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
          newValue: {
            name: { ar: trimmedNameAr, en: trimmedNameEn },
            slug: trimmedSlug,
            serviceTypeKey,
            parentId,
            depth,
            visibilityStatus: "HIDDEN",
          },
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
      parentId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
