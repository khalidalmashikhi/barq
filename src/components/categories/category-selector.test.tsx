import { describe, it, expect, vi } from "vitest";
import { CategorySelector } from "./category-selector";
import type { CategoryNode, CategoryTree } from "@/lib/categories/category-tree";

// CategorySelector is a stateless, controlled component, so it can be invoked
// as a plain function and its returned element tree walked — the same
// convention as the existing Server Component tests (no @testing-library in
// this repo). These assert what it RENDERS for given props; interaction lives
// in CategoryField (state) and is covered there.

type AnyElement = { type: unknown; props: Record<string, unknown> };

function collect(element: unknown, predicate: (el: AnyElement) => boolean, acc: AnyElement[] = []): AnyElement[] {
  if (!element || typeof element !== "object") return acc;
  if (Array.isArray(element)) {
    for (const child of element) collect(child, predicate, acc);
    return acc;
  }
  const el = element as AnyElement;
  if (predicate(el)) acc.push(el);
  if (el.props?.children !== undefined) collect(el.props.children, predicate, acc);
  return acc;
}

function textOf(element: unknown, acc: string[] = []): string[] {
  if (element === null || element === undefined || typeof element === "boolean") return acc;
  if (typeof element === "string" || typeof element === "number") {
    acc.push(String(element));
    return acc;
  }
  if (Array.isArray(element)) {
    for (const child of element) textOf(child, acc);
    return acc;
  }
  const el = element as AnyElement;
  if (el.props?.children !== undefined) textOf(el.props.children, acc);
  return acc;
}

const treeItems = (el: AnyElement) => el.type === "button" && el.props.role === "treeitem";

function node(id: string, label: string, children: CategoryNode[] = [], depth = 0, extra: Partial<CategoryNode> = {}): CategoryNode {
  return { id, label, slug: id, parentId: null, depth, iconKey: null, colorHex: null, children, ...extra };
}

function fixture(): CategoryTree {
  return {
    locale: "en",
    nodes: [node("tours", "Tours", [node("boat", "Boat Tours", [], 1)]), node("stay", "Stay")],
  };
}

const labels = { searchPlaceholder: "Search categories", empty: "No categories" };

function render(overrides: Partial<Parameters<typeof CategorySelector>[0]> = {}) {
  return CategorySelector({
    tree: fixture(),
    selectedId: null,
    breadcrumb: [],
    query: "",
    onSelect: vi.fn(),
    onQueryChange: vi.fn(),
    labels,
    ...overrides,
  });
}

describe("CategorySelector", () => {
  it("renders one treeitem per node, in pre-order, with the resolved labels", () => {
    const items = collect(render(), treeItems);
    const texts = items.map((el) => textOf(el.props.children).join(""));
    expect(texts).toEqual(["Tours", "Boat Tours", "Stay"]);
  });

  it("carries aria-level reflecting depth", () => {
    const byLabel = new Map(
      collect(render(), treeItems).map((el) => [textOf(el.props.children).join(""), el.props["aria-level"]])
    );
    expect(byLabel.get("Tours")).toBe(1);
    expect(byLabel.get("Boat Tours")).toBe(2);
  });

  it("marks the selected node with aria-selected and no other", () => {
    const items = collect(render({ selectedId: "boat" }), treeItems);
    const selected = items.filter((el) => el.props["aria-selected"] === true);
    expect(selected).toHaveLength(1);
    expect(textOf(selected[0]!.props.children).join("")).toBe("Boat Tours");
  });

  it("invokes onSelect with the node id when a treeitem is activated", () => {
    const onSelect = vi.fn();
    const items = collect(render({ onSelect }), treeItems);
    (items[2]!.props.onClick as () => void)(); // "Stay"
    expect(onSelect).toHaveBeenCalledWith("stay");
  });

  it("renders a controlled search input wired to onQueryChange", () => {
    const onQueryChange = vi.fn();
    const inputs = collect(render({ query: "bo", onQueryChange }), (el) => el.type === "input");
    const search = inputs.find((el) => el.props.type === "search");
    expect(search?.props.value).toBe("bo");
    expect(search?.props.placeholder).toBe("Search categories");
    (search!.props.onChange as (e: unknown) => void)({ target: { value: "boa" } });
    expect(onQueryChange).toHaveBeenCalledWith("boa");
  });

  it("renders the breadcrumb labels when provided", () => {
    const breadcrumb = [
      { id: "tours", label: "Tours", slug: "tours" },
      { id: "boat", label: "Boat Tours", slug: "boat" },
    ];
    const texts = textOf(render({ selectedId: "boat", breadcrumb }));
    expect(texts.join("")).toContain("Tours");
    expect(texts.join("")).toContain("Boat Tours");
  });

  it("shows the empty label and no tree when the tree has no nodes", () => {
    const el = render({ tree: { locale: "en", nodes: [] } });
    expect(collect(el, treeItems)).toHaveLength(0);
    expect(textOf(el).join("")).toContain("No categories");
  });

  it("renders a color swatch only when colorHex is present (absent-safe)", () => {
    const tree: CategoryTree = {
      locale: "en",
      nodes: [node("a", "Plain"), node("b", "Styled", [], 0, { colorHex: "#0EA5E9" })],
    };
    const swatches = collect(render({ tree }), (el) => el.type === "span" && el.props.style !== undefined && typeof el.props.style === "object" && (el.props.style as Record<string, unknown>).backgroundColor === "#0EA5E9");
    expect(swatches).toHaveLength(1);
  });
});
