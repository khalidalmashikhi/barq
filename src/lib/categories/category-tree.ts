// Category tree invariants (ADR-0015). Kept OUT of the "use server" action
// files: a "use server" module may only export async functions, so this plain
// constant lives here and is imported wherever the depth rule is enforced —
// the single source of truth for the tree's maximum depth (BR-027).

// Number of levels allowed in the Category tree: root = depth 0, child =
// depth 1. A node whose depth would be >= this is rejected. Hard cap 3;
// raising it later is a code change here (plus a UUID `path` column when
// subtree filtering is needed) — never a schema migration.
export const MAX_CATEGORY_DEPTH = 2;

// ---------------------------------------------------------------------------
// CategoryTree DTO + pure tree operations (CategorySelector foundation).
//
// This is an INTERNAL application DTO that is intentionally API-ready — NOT a
// frozen public/mobile API contract. A public contract must be versioned and
// reviewed independently before any external release; none is created here.
//
// This module is deliberately dependency-free (no Prisma, next-intl, or
// server-only imports) so the same types and pure functions are reusable from
// server queries, client components (CategorySelector/CategoryField), a future
// read model, and tests alike. Tree CONSTRUCTION and label resolution live in
// build-category-tree.ts; RECORD SELECTION (e.g. PUBLIC-only) lives in the
// server queries that call the builder — never here.
// ---------------------------------------------------------------------------

// A single node in a resolved category tree. `label` is the already
// locale-resolved display string (never raw multilingual JSON). `parentId` is
// retained even though the tree is nested (per the DTO contract) so a consumer
// can relate a node to its parent without walking the tree. `iconKey`/
// `colorHex` are intrinsic presentation fields owned by Category (task A); they
// are null until that data exists and every renderer must be absent-safe.
export type CategoryNode = {
  id: string;
  label: string;
  slug: string;
  parentId: string | null;
  depth: number;
  iconKey: string | null;
  colorHex: string | null;
  children: CategoryNode[];
};

// A resolved tree, tagged with the locale its labels were resolved in (useful
// for caching/debugging and for a future locale-aware read model).
export type CategoryTree = {
  locale: string;
  nodes: CategoryNode[];
};

// One segment of a root-to-node breadcrumb path.
export type CategoryBreadcrumbItem = {
  id: string;
  label: string;
  slug: string;
};

// Depth-first, pre-order flattening — parents before their children, sibling
// order preserved. Useful for list rendering, keyboard roving, and mobile.
export function flattenCategoryTree(tree: CategoryTree): CategoryNode[] {
  const out: CategoryNode[] = [];
  const walk = (nodes: CategoryNode[]): void => {
    for (const node of nodes) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(tree.nodes);
  return out;
}

// Case-insensitive label search that PRESERVES tree shape. A node is kept when
// it matches (in which case its whole subtree is kept, so a user can drill into
// a matched branch) or when a descendant matches (the non-matching ancestor is
// retained purely as scaffolding, with only match-bearing children). An empty
// or whitespace-only query returns the tree unchanged. Returns a new tree; the
// input is never mutated. Pure — the same function can later run server-side.
export function searchCategoryTree(tree: CategoryTree, query: string): CategoryTree {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return tree;

  const filter = (nodes: CategoryNode[]): CategoryNode[] => {
    const kept: CategoryNode[] = [];
    for (const node of nodes) {
      if (node.label.toLowerCase().includes(needle)) {
        kept.push(node); // self-match: keep the entire subtree
        continue;
      }
      const keptChildren = filter(node.children);
      if (keptChildren.length > 0) {
        kept.push({ ...node, children: keptChildren });
      }
    }
    return kept;
  };

  return { locale: tree.locale, nodes: filter(tree.nodes) };
}

// Root-to-node breadcrumb (inclusive of the node itself). Returns an empty
// array when the id is not present in the tree. Pure.
export function getCategoryBreadcrumb(tree: CategoryTree, id: string): CategoryBreadcrumbItem[] {
  const found: CategoryBreadcrumbItem[] = [];

  const walk = (nodes: CategoryNode[], trail: CategoryBreadcrumbItem[]): boolean => {
    for (const node of nodes) {
      const nextTrail = [...trail, { id: node.id, label: node.label, slug: node.slug }];
      if (node.id === id) {
        found.push(...nextTrail);
        return true;
      }
      if (walk(node.children, nextTrail)) return true;
    }
    return false;
  };

  walk(tree.nodes, []);
  return found;
}
