import "server-only";
import { requireProvider } from "@/lib/auth";
import { getSelectableCategories } from "@/lib/categories/get-selectable-categories";
import { DEFAULT_SERVICE_TYPE_KEY } from "@/lib/service-types";
import { getProviderCategoryIds } from "./get-provider-categories";
import type { CategoryTree } from "@/lib/categories/category-tree";

// Feeds the provider's own "areas of activity" multi-select (Gap G): the tree
// of admin-managed, effectively-selectable categories to choose from (reusing
// the SAME rule as the service picker — no hardcoded list, serviceType-scoped,
// effective visibility preserved) plus the ids this provider has already
// selected, so a returning provider sees and edits their current choices.

export type ProviderCategorySelection = { tree: CategoryTree; selectedIds: string[] };

export async function getMyProviderCategorySelection(): Promise<ProviderCategorySelection> {
  const { provider } = await requireProvider();
  const [tree, selectedIds] = await Promise.all([
    getSelectableCategories(DEFAULT_SERVICE_TYPE_KEY),
    getProviderCategoryIds(provider.id),
  ]);
  return { tree, selectedIds };
}
