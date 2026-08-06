import "server-only";
import { prisma } from "@/lib/db";
import { isValidUuid } from "@/lib/uuid";
import { selectableCategoryWhere, isCategoryEffectivelySelectable } from "./selectable-category-rule";

// Server-side re-validation for a client-submitted categoryId (Task B). The
// picker only OFFERS selectable categories, but the submitted id is untrusted
// input, so every create/update action re-checks it here before assignment —
// consuming the SAME shared rule the picker uses (coarse `where` + effective
// predicate), so a value the picker would never show is also rejected here.
//
// Returns true only when the category exists, is effectively PUBLIC (self +
// ancestors), and matches the service's serviceType. Used only when a non-empty
// categoryId is submitted; assignment itself is optional (drafts may be
// uncategorized — the requirement is enforced at publish time).

export async function assertAssignableCategory(categoryId: string, serviceType: string): Promise<boolean> {
  if (!isValidUuid(categoryId)) return false;

  const category = await prisma.category.findFirst({
    where: { id: categoryId, ...selectableCategoryWhere(serviceType) },
    select: {
      visibilityStatus: true,
      serviceTypeKey: true,
      parent: { select: { visibilityStatus: true } },
    },
  });

  if (!category) return false;

  return isCategoryEffectivelySelectable(
    {
      visibilityStatus: category.visibilityStatus,
      serviceTypeKey: category.serviceTypeKey,
      ancestorStatuses: category.parent ? [category.parent.visibilityStatus] : [],
    },
    serviceType
  );
}
