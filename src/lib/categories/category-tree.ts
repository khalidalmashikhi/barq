// Category tree invariants (ADR-0015). Kept OUT of the "use server" action
// files: a "use server" module may only export async functions, so this plain
// constant lives here and is imported wherever the depth rule is enforced —
// the single source of truth for the tree's maximum depth (BR-027).

// Number of levels allowed in the Category tree: root = depth 0, child =
// depth 1. A node whose depth would be >= this is rejected. Hard cap 3;
// raising it later is a code change here (plus a UUID `path` column when
// subtree filtering is needed) — never a schema migration.
export const MAX_CATEGORY_DEPTH = 2;
