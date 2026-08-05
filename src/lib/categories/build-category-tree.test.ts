import { describe, it, expect } from "vitest";
import { buildCategoryTree, type CategoryTreeRow } from "./build-category-tree";

// The generic tree builder: nesting, label resolution, sibling ordering, and
// the lossless orphan-as-root rule. It must contain NO visibility filtering —
// callers select the eligible rows.

function row(overrides: Partial<CategoryTreeRow> & { id: string }): CategoryTreeRow {
  return {
    name: { ar: `${overrides.id}-ar`, en: `${overrides.id}-en` },
    slug: overrides.id,
    parentId: null,
    ...overrides,
  };
}

describe("buildCategoryTree", () => {
  it("nests children under their parent via parentId", () => {
    const tree = buildCategoryTree(
      [row({ id: "root" }), row({ id: "child", parentId: "root" })],
      "en"
    );
    expect(tree.nodes.map((n) => n.id)).toEqual(["root"]);
    expect(tree.nodes[0]!.children.map((n) => n.id)).toEqual(["child"]);
  });

  it("resolves labels for the requested locale and assigns depth", () => {
    const tree = buildCategoryTree(
      [row({ id: "root" }), row({ id: "child", parentId: "root" })],
      "en"
    );
    expect(tree.locale).toBe("en");
    const root = tree.nodes[0]!;
    expect(root.label).toBe("root-en");
    expect(root.depth).toBe(0);
    const child = root.children[0]!;
    expect(child.label).toBe("child-en");
    expect(child.depth).toBe(1);
  });

  it("falls back to Arabic then slug when the requested locale is absent", () => {
    const tree = buildCategoryTree(
      [
        row({ id: "ar-only", name: { ar: "عربي" } }),
        row({ id: "blank", name: {} }),
      ],
      "de"
    );
    expect(tree.nodes.find((n) => n.id === "ar-only")?.label).toBe("عربي");
    expect(tree.nodes.find((n) => n.id === "blank")?.label).toBe("blank"); // slug fallback
  });

  it("orders siblings by sortOrder, stably for equal values", () => {
    const tree = buildCategoryTree(
      [
        row({ id: "b", sortOrder: 1 }),
        row({ id: "a", sortOrder: 0 }),
        row({ id: "c", sortOrder: 1 }), // equal to b -> keeps input order (b before c)
      ],
      "en"
    );
    expect(tree.nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("treats a row whose parent is absent from the set as a root (lossless), preserving its true parentId", () => {
    const tree = buildCategoryTree([row({ id: "orphan", parentId: "gone" })], "en");
    expect(tree.nodes.map((n) => n.id)).toEqual(["orphan"]);
    expect(tree.nodes[0]!.parentId).toBe("gone");
    expect(tree.nodes[0]!.depth).toBe(0);
  });

  it("defaults iconKey/colorHex to null and passes them through when present", () => {
    const tree = buildCategoryTree(
      [
        row({ id: "plain" }),
        row({ id: "styled", iconKey: "compass", colorHex: "#0EA5E9" }),
      ],
      "en"
    );
    expect(tree.nodes.find((n) => n.id === "plain")).toMatchObject({ iconKey: null, colorHex: null });
    expect(tree.nodes.find((n) => n.id === "styled")).toMatchObject({ iconKey: "compass", colorHex: "#0EA5E9" });
  });

  it("returns an empty forest for no rows", () => {
    expect(buildCategoryTree([], "en")).toEqual({ locale: "en", nodes: [] });
  });
});
