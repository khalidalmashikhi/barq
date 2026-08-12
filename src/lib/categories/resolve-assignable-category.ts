import "server-only";
import { prisma } from "@/lib/db";
import { isValidUuid } from "@/lib/uuid";
import { isValidServiceTypeKey } from "@/lib/service-types";
import { isCategoryEffectivelyVisible } from "./category-visibility-policy";

// Authoritative category resolver for service assignment (BR-028). Given a
// client-submitted categoryId, returns the category's OWN serviceTypeKey iff the
// category is assignable — effectively PUBLIC (its own status is PUBLIC in SQL,
// and no ancestor is HIDDEN/ARCHIVED) and its serviceTypeKey is a governed
// vertical — otherwise null.
//
// This is the SINGLE source of truth from which a Service's serviceType is
// DERIVED (the BR-028 invariant: Service.serviceType === Category.serviceTypeKey):
// the vertical comes from the category, never from client input or a hardcoded
// literal. assertAssignableCategory(categoryId, serviceType) is a thin wrapper
// over this (resolve, then compare the derived key to a known serviceType), so
// there is one lookup and one rule.

export type ResolvedAssignableCategory = { serviceTypeKey: string };

export async function resolveAssignableCategory(categoryId: string): Promise<ResolvedAssignableCategory | null> {
  if (!isValidUuid(categoryId)) return null;

  const category = await prisma.category.findFirst({
    where: { id: categoryId, visibilityStatus: "PUBLIC" },
    select: {
      visibilityStatus: true,
      serviceTypeKey: true,
      parent: { select: { visibilityStatus: true } },
    },
  });

  if (!category) return null;

  // Defensive — the DB CHECK guarantees a stored serviceTypeKey is a governed
  // key, but never derive a Service vertical from an unrecognized value.
  if (!isValidServiceTypeKey(category.serviceTypeKey)) return null;

  const effectivelyVisible = isCategoryEffectivelyVisible(
    category.visibilityStatus,
    category.parent ? [category.parent.visibilityStatus] : []
  );
  if (!effectivelyVisible) return null;

  return { serviceTypeKey: category.serviceTypeKey };
}
