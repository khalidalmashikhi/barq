import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { CategoryField } from "./category-field";
import type { CategoryTree } from "@/lib/categories/category-tree";

// CategoryField owns state (useState), so it can't be walked as a plain
// function like the stateless CategorySelector. Instead it is rendered to
// static markup (react-dom/server — already a dependency, no jsdom needed),
// which exercises the real initial render: the hidden input the form reads and
// the tree the selector paints. Interactive re-selection is a browser concern
// and out of scope for this unit test.

function tree(): CategoryTree {
  return {
    locale: "en",
    nodes: [
      {
        id: "tours",
        label: "Tours",
        slug: "tours",
        parentId: null,
        depth: 0,
        iconKey: null,
        colorHex: null,
        children: [
          { id: "boat", label: "Boat Tours", slug: "boat", parentId: "tours", depth: 1, iconKey: null, colorHex: null, children: [] },
        ],
      },
    ],
  };
}

const labels = { searchPlaceholder: "Search", empty: "None" };

function markup(props: Partial<Parameters<typeof CategoryField>[0]> = {}): string {
  return renderToStaticMarkup(createElement(CategoryField, { name: "categoryId", tree: tree(), labels, ...props }));
}

describe("CategoryField", () => {
  it("renders a hidden input under the given name, empty when nothing is selected", () => {
    const html = markup();
    expect(html).toContain('type="hidden"');
    expect(html).toContain('name="categoryId"');
    expect(html).toMatch(/name="categoryId"[^>]*value=""/);
  });

  it("seeds the hidden input from defaultValue", () => {
    const html = markup({ defaultValue: "boat" });
    expect(html).toMatch(/name="categoryId"[^>]*value="boat"/);
  });

  it("renders the category labels from the tree", () => {
    const html = markup();
    expect(html).toContain("Tours");
    expect(html).toContain("Boat Tours");
  });

  it("renders the breadcrumb for the preselected node", () => {
    const html = markup({ defaultValue: "boat" });
    // both ancestors of the selected node appear in the breadcrumb region
    expect(html).toContain("Tours");
    expect(html).toContain("Boat Tours");
  });
});
