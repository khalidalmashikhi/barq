import { flattenCategoryTree, type CategoryTree } from "@/lib/categories/category-tree";

// Gate B4 — SINGLE-select primary-activity picker (replaces the multi-select
// checklist for provider self-selection). Native radio inputs enforce "exactly
// one" in the browser; the server (applyAsProvider / setProviderPrimaryActivity)
// re-enforces it regardless. `name` is caller-chosen so it fits either action's
// field ("categoryIds" for apply, "categoryId" for the settings primary edit).

type Props = {
  tree: CategoryTree;
  selectedId?: string | null;
  emptyLabel: string;
  name?: string;
};

export function ProviderPrimaryActivityPicker({ tree, selectedId, emptyLabel, name = "categoryId" }: Props) {
  const nodes = flattenCategoryTree(tree);

  if (nodes.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-foreground/50">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto rounded-xl border border-border bg-card p-1.5">
      {nodes.map((node) => (
        <label
          key={node.id}
          style={{ paddingInlineStart: `${node.depth * 1.25 + 0.5}rem` }}
          className="flex cursor-pointer items-center gap-2.5 rounded-lg py-2 pe-3 text-sm text-foreground/80 transition-colors hover:bg-foreground/5"
        >
          <input
            type="radio"
            name={name}
            value={node.id}
            defaultChecked={selectedId === node.id}
            className="h-4 w-4 shrink-0 border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          />
          <span className="truncate">{node.label}</span>
        </label>
      ))}
    </div>
  );
}
