import { flattenCategoryTree, type CategoryTree } from "@/lib/categories/category-tree";

// Provider "areas of activity" multi-select (Gap G). A pure, server-rendered
// checklist over the same admin-managed CategoryTree the service picker uses —
// no hardcoded list. Native checkboxes named `categoryIds` submit as multiple
// values (read by set-provider-categories via formData.getAll). Depth-indented,
// RTL-safe (paddingInlineStart), and shows an empty state when no selectable
// categories exist. No client JS needed — the browser handles multi-selection.

type Props = {
  tree: CategoryTree;
  selectedIds: string[];
  emptyLabel: string;
  name?: string;
};

export function ProviderCategoryChecklist({ tree, selectedIds, emptyLabel, name = "categoryIds" }: Props) {
  const nodes = flattenCategoryTree(tree);

  if (nodes.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-foreground/50">
        {emptyLabel}
      </p>
    );
  }

  const selected = new Set(selectedIds);

  return (
    <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto rounded-xl border border-border bg-card p-1.5">
      {nodes.map((node) => (
        <label
          key={node.id}
          style={{ paddingInlineStart: `${node.depth * 1.25 + 0.5}rem` }}
          className="flex cursor-pointer items-center gap-2.5 rounded-lg py-2 pe-3 text-sm text-foreground/80 transition-colors hover:bg-foreground/5"
        >
          <input
            type="checkbox"
            name={name}
            value={node.id}
            defaultChecked={selected.has(node.id)}
            className="h-4 w-4 shrink-0 rounded border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          />
          <span className="truncate">{node.label}</span>
        </label>
      ))}
    </div>
  );
}
