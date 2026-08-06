import "server-only";
import type { Prisma } from "@prisma/client";

// The shared PUBLIC-visibility rule for CUSTOMER-FACING category browse
// (B2 read path). Distinct from selectable-category-rule.ts — the WRITE-path
// assignment rule, which additionally scopes to a service's serviceType.
// Customer browse spans every vertical, so this filters ONLY on a category's
// OWN status (visibilityStatus === PUBLIC). EFFECTIVE (ancestor) visibility is
// applied on the loaded row via isCategoryEffectivelyVisible — the same helper
// the selectable rule reuses — so the visibility rule itself is never
// duplicated across the two read models.
export function publicCategoryWhere(): Prisma.CategoryWhereInput {
  return { visibilityStatus: "PUBLIC" };
}
