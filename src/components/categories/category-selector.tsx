"use client";

import type { ReactElement } from "react";
import { Search, Check } from "lucide-react";
import { clsx } from "@/components/ui/clsx";
import type { CategoryNode, CategoryTree, CategoryBreadcrumbItem } from "@/lib/categories/category-tree";

// CategorySelector — the reusable, controlled RENDERING layer for BARQ's
// category picking (ADR-0015 foundation). It renders a CategoryTree and reports
// selection/search intent; it holds no state and owns no business logic.
//
// Deliberately NOT tied to any container: no dropdown, dialog, popover, or
// bottom sheet. A future CategoryPicker will wrap this same component in
// whichever surface a context needs (inline in a form today via CategoryField;
// a dropdown/sheet later) without this component changing.
//
// Boundaries (kept strict on purpose):
//  - No Prisma, next-intl, server actions, or DB access.
//  - No tree building, searching, or breadcrumb generation — those are pure
//    domain functions; the caller passes an already-filtered `tree` and a
//    precomputed `breadcrumb`.
//  - No form binding (hidden input) — that is CategoryField's job.
//
// All user-facing strings arrive as `labels` and every `label` in the tree is
// already locale-resolved, so this component is i18n-agnostic and reusable
// across admin, provider, and (later) mobile. Layout uses logical properties
// (paddingInlineStart) so it mirrors correctly under RTL.

export type CategorySelectorLabels = {
  searchPlaceholder: string;
  empty: string;
};

type CategorySelectorProps = {
  tree: CategoryTree;
  selectedId: string | null;
  breadcrumb: CategoryBreadcrumbItem[];
  query: string;
  onSelect: (id: string) => void;
  onQueryChange: (query: string) => void;
  labels: CategorySelectorLabels;
  disabled?: boolean;
};

export function CategorySelector({
  tree,
  selectedId,
  breadcrumb,
  query,
  onSelect,
  onQueryChange,
  labels,
  disabled = false,
}: CategorySelectorProps) {
  // Flat, pre-order render: children follow their parent as sibling treeitems
  // with aria-level carrying the hierarchy (a valid ARIA tree pattern that
  // keeps every row a native, keyboard-operable <button> and avoids nesting
  // interactive controls). Indentation communicates depth visually.
  const renderNodes = (nodes: CategoryNode[]): ReactElement[] => {
    const items: ReactElement[] = [];
    for (const node of nodes) {
      const isSelected = node.id === selectedId;
      items.push(
        <button
          key={node.id}
          type="button"
          role="treeitem"
          aria-level={node.depth + 1}
          aria-selected={isSelected}
          disabled={disabled}
          onClick={() => onSelect(node.id)}
          style={{ paddingInlineStart: `${node.depth * 1.25 + 0.75}rem` }}
          className={clsx(
            "flex w-full items-center gap-2 rounded-xl py-2 pe-3 text-start text-sm transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50",
            isSelected
              ? "bg-primary/10 font-medium text-primary"
              : "text-foreground/80 hover:bg-foreground/5 hover:text-foreground"
          )}
        >
          {node.colorHex ? (
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: node.colorHex }}
            />
          ) : null}
          <span className="truncate">{node.label}</span>
          {isSelected ? <Check size={16} strokeWidth={2} className="ms-auto shrink-0" /> : null}
        </button>
      );
      items.push(...renderNodes(node.children));
    }
    return items;
  };

  const isEmpty = tree.nodes.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2.5 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
        <Search size={16} strokeWidth={1.75} className="shrink-0 text-foreground/40" />
        <input
          type="search"
          value={query}
          disabled={disabled}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={labels.searchPlaceholder}
          aria-label={labels.searchPlaceholder}
          className="w-full bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
        />
      </div>

      {breadcrumb.length > 0 ? (
        <p aria-live="polite" className="flex flex-wrap items-center text-xs text-foreground/60">
          {breadcrumb.map((crumb, index) => (
            <span key={crumb.id} className="inline-flex items-center">
              {index > 0 ? (
                <span aria-hidden className="mx-1.5 text-foreground/30">
                  /
                </span>
              ) : null}
              {crumb.label}
            </span>
          ))}
        </p>
      ) : null}

      {isEmpty ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-foreground/50">
          {labels.empty}
        </p>
      ) : (
        <div role="tree" className="max-h-72 overflow-y-auto rounded-xl border border-border bg-card p-1.5">
          {renderNodes(tree.nodes)}
        </div>
      )}
    </div>
  );
}
