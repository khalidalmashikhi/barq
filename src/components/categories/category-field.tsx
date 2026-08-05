"use client";

import { useState } from "react";
import { CategorySelector, type CategorySelectorLabels } from "./category-selector";
import { searchCategoryTree, getCategoryBreadcrumb, type CategoryTree } from "@/lib/categories/category-tree";

// CategoryField — the form/state integration wrapper around CategorySelector
// (ADR-0015 foundation). It is the piece a server-action <form> embeds: it owns
// the selection and search UI state and emits the chosen category id through a
// hidden <input name={name}>, so the existing formData.get(name) server actions
// read it with no special handling.
//
// It renders INLINE in V1 (no dropdown/dialog/sheet — those come later, wrapping
// the same CategorySelector). It contains no business logic: filtering and
// breadcrumb derivation are delegated to the pure domain functions; this
// component only holds state and wires them to the renderer.
//
// The field is intentionally optional at the form level — category becomes
// REQUIRED only at publish time, enforced server-side (drafts may stay
// uncategorized), so there is no client `required` here.

type CategoryFieldProps = {
  name: string;
  tree: CategoryTree;
  defaultValue?: string | null;
  labels: CategorySelectorLabels;
  disabled?: boolean;
};

export function CategoryField({ name, tree, defaultValue = null, labels, disabled = false }: CategoryFieldProps) {
  const [selectedId, setSelectedId] = useState<string | null>(defaultValue);
  const [query, setQuery] = useState("");

  const visibleTree = searchCategoryTree(tree, query);
  const breadcrumb = selectedId ? getCategoryBreadcrumb(tree, selectedId) : [];

  return (
    <>
      <input type="hidden" name={name} value={selectedId ?? ""} />
      <CategorySelector
        tree={visibleTree}
        selectedId={selectedId}
        breadcrumb={breadcrumb}
        query={query}
        onSelect={setSelectedId}
        onQueryChange={setQuery}
        labels={labels}
        disabled={disabled}
      />
    </>
  );
}
