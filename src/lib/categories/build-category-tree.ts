import type { Locale } from "@/i18n/locales";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import type { CategoryNode, CategoryTree } from "./category-tree";

// Generic Category tree builder (CategorySelector foundation).
//
// RESPONSIBILITY: turn a flat list of already-SELECTED category rows into a
// nested, locale-resolved CategoryTree. It is intentionally GENERIC — it builds
// a tree from whatever rows it is given and contains NO business filtering.
// Deciding WHICH rows are eligible (e.g. PUBLIC-only for a provider/customer
// picker, or HIDDEN/ARCHIVED-inclusive for an admin tree) is the caller's job
// (the server query). The same builder therefore serves every audience.
//
// Labels are resolved once here via extractLocalizedText (requested locale ->
// ar -> en -> slug), so no consumer — server, React, or a future read model —
// ever re-derives a display string from raw multilingual JSON.

// The minimal row shape the builder needs. Deliberately structural (not a
// Prisma type) so any query — or a test — can produce it. `name` is the raw
// multilingual JSON map; `iconKey`/`colorHex` are optional and default to null
// (they arrive with Category intrinsic enrichment, task A).
export type CategoryTreeRow = {
  id: string;
  name: unknown;
  slug: string;
  parentId: string | null;
  sortOrder?: number;
  iconKey?: string | null;
  colorHex?: string | null;
};

export function buildCategoryTree(rows: CategoryTreeRow[], locale: Locale): CategoryTree {
  const knownIds = new Set(rows.map((row) => row.id));

  // Group rows by their effective parent. A row is a root when it has no parent
  // OR when its parent is not part of this row set (an "orphan"): rather than
  // silently drop such a row, it is surfaced at the top level so the builder is
  // lossless. A closed set (roots + all their descendants, as every query here
  // produces) never triggers the orphan path. The node still reports its true
  // stored `parentId`.
  const childrenByParent = new Map<string | null, CategoryTreeRow[]>();
  for (const row of rows) {
    const effectiveParent = row.parentId && knownIds.has(row.parentId) ? row.parentId : null;
    const siblings = childrenByParent.get(effectiveParent) ?? [];
    siblings.push(row);
    childrenByParent.set(effectiveParent, siblings);
  }

  // Stable sort within each sibling group by sortOrder (Array.prototype.sort is
  // stable, so equal sortOrder values keep the query's incoming order).
  for (const siblings of childrenByParent.values()) {
    siblings.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }

  const assemble = (parentKey: string | null, depth: number): CategoryNode[] => {
    const siblings = childrenByParent.get(parentKey) ?? [];
    return siblings.map((row) => ({
      id: row.id,
      label: extractLocalizedText(row.name, locale) || row.slug,
      slug: row.slug,
      parentId: row.parentId,
      depth,
      iconKey: row.iconKey ?? null,
      colorHex: row.colorHex ?? null,
      children: assemble(row.id, depth + 1),
    }));
  };

  return { locale, nodes: assemble(null, 0) };
}
