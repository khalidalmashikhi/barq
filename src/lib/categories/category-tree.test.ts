import { describe, it, expect } from "vitest";
import {
  flattenCategoryTree,
  searchCategoryTree,
  getCategoryBreadcrumb,
  type CategoryNode,
  type CategoryTree,
} from "./category-tree";

// Pure CategoryTree operations (CategorySelector foundation). No DOM, no
// Prisma, no i18n runtime — just the tree algorithms. These carry the bulk of
// the picker's logic so the React layers can stay render-only.

function node(id: string, label: string, children: CategoryNode[] = [], depth = 0): CategoryNode {
  return {
    id,
    label,
    slug: id,
    parentId: null,
    depth,
    iconKey: null,
    colorHex: null,
    children,
  };
}

// A small bilingual-ish fixture: two roots, one with children.
function fixture(): CategoryTree {
  return {
    locale: "en",
    nodes: [
      node("tours", "Tours & Activities", [
        node("boat", "Boat Tours", [], 1),
        node("desert", "Desert Safari", [], 1),
      ]),
      node("stay", "Places to Stay", [node("hotel", "Hotels", [], 1)]),
    ],
  };
}

describe("flattenCategoryTree", () => {
  it("returns nodes depth-first, pre-order, preserving sibling order", () => {
    const flat = flattenCategoryTree(fixture()).map((n) => n.id);
    expect(flat).toEqual(["tours", "boat", "desert", "stay", "hotel"]);
  });

  it("returns an empty array for an empty tree", () => {
    expect(flattenCategoryTree({ locale: "en", nodes: [] })).toEqual([]);
  });
});

describe("searchCategoryTree", () => {
  it("returns the tree unchanged for an empty/whitespace query", () => {
    const tree = fixture();
    expect(searchCategoryTree(tree, "")).toBe(tree);
    expect(searchCategoryTree(tree, "   ")).toBe(tree);
  });

  it("keeps a matching leaf and the ancestors that lead to it, dropping the rest", () => {
    const result = searchCategoryTree(fixture(), "boat");
    expect(result.nodes.map((n) => n.id)).toEqual(["tours"]);
    expect(result.nodes[0]!.children.map((n) => n.id)).toEqual(["boat"]);
  });

  it("keeps the WHOLE subtree of a node that itself matches", () => {
    // "tours" matches -> both its children survive even though they don't match.
    const result = searchCategoryTree(fixture(), "Tours &");
    expect(result.nodes.map((n) => n.id)).toEqual(["tours"]);
    expect(result.nodes[0]!.children.map((n) => n.id)).toEqual(["boat", "desert"]);
  });

  it("is case-insensitive", () => {
    const result = searchCategoryTree(fixture(), "HOTELS");
    expect(result.nodes.map((n) => n.id)).toEqual(["stay"]);
    expect(result.nodes[0]!.children.map((n) => n.id)).toEqual(["hotel"]);
  });

  it("matches Arabic labels", () => {
    const tree: CategoryTree = { locale: "ar", nodes: [node("t", "جولات"), node("s", "إقامة")] };
    const result = searchCategoryTree(tree, "إقامة");
    expect(result.nodes.map((n) => n.id)).toEqual(["s"]);
  });

  it("returns no nodes when nothing matches", () => {
    expect(searchCategoryTree(fixture(), "zzz").nodes).toEqual([]);
  });

  it("does not mutate the input tree", () => {
    const tree = fixture();
    const snapshot = JSON.stringify(tree);
    searchCategoryTree(tree, "boat");
    expect(JSON.stringify(tree)).toBe(snapshot);
  });
});

describe("getCategoryBreadcrumb", () => {
  it("returns the root-to-node path, inclusive, for a nested node", () => {
    const crumb = getCategoryBreadcrumb(fixture(), "boat").map((c) => c.id);
    expect(crumb).toEqual(["tours", "boat"]);
  });

  it("returns a single item for a root node", () => {
    const crumb = getCategoryBreadcrumb(fixture(), "stay").map((c) => c.id);
    expect(crumb).toEqual(["stay"]);
  });

  it("returns an empty array for an unknown id", () => {
    expect(getCategoryBreadcrumb(fixture(), "missing")).toEqual([]);
  });

  it("carries label and slug on each crumb", () => {
    const crumb = getCategoryBreadcrumb(fixture(), "boat");
    expect(crumb.at(-1)).toEqual({ id: "boat", label: "Boat Tours", slug: "boat" });
  });
});
