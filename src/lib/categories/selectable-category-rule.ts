import "server-only";
import type { CategoryVisibilityStatus, Prisma } from "@prisma/client";
import { isCategoryEffectivelyVisible } from "./category-visibility-policy";

// The SINGLE source of truth for "which categories may a Service be filed
// under" (Task B). Deliberately expressed as two co-located representations of
// ONE rule, which MUST change together:
//
//  1. selectableCategoryWhere(serviceType) — the coarse DB filter (a category's
//     OWN status is PUBLIC and its serviceTypeKey matches the service). Used as
//     the base `where` by every query so the eligibility predicate is never
//     re-spelled as an ad-hoc Prisma clause.
//  2. isCategoryEffectivelySelectable(category, serviceType) — the full
//     predicate, adding EFFECTIVE visibility: a category is only selectable if
//     it AND every ancestor is PUBLIC. It reuses isCategoryEffectivelyVisible
//     so the visibility rule itself lives in exactly one place.
//
// Both getSelectableCategories() and assertAssignableCategory() consume BOTH:
// the `where` narrows to own-PUBLIC + type in SQL; the predicate then enforces
// the ancestor rule on the loaded rows. An equivalence test pins them together.

export function selectableCategoryWhere(serviceType: string): Prisma.CategoryWhereInput {
  return { visibilityStatus: "PUBLIC", serviceTypeKey: serviceType };
}

// `ancestorStatuses` is the ordered list of this category's ancestors' statuses.
// At MAX_CATEGORY_DEPTH = 2 that is just the immediate parent (or empty for a
// root); if the tree's depth is ever raised, callers must pass every ancestor —
// isCategoryEffectivelyVisible already evaluates the full list.
export function isCategoryEffectivelySelectable(
  category: {
    visibilityStatus: CategoryVisibilityStatus;
    serviceTypeKey: string;
    ancestorStatuses?: readonly CategoryVisibilityStatus[];
  },
  serviceType: string
): boolean {
  return (
    category.serviceTypeKey === serviceType &&
    isCategoryEffectivelyVisible(category.visibilityStatus, category.ancestorStatuses ?? [])
  );
}
