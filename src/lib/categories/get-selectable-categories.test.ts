import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const findManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { category: { findMany: (...args: unknown[]) => findManyMock(...args) } },
}));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));

const { getSelectableCategories } = await import("./get-selectable-categories");
const { selectableCategoryWhere } = await import("./selectable-category-rule");

type RowOverrides = {
  id: string;
  en?: string;
  parentId?: string | null;
  sortOrder?: number;
  visibilityStatus?: string;
  serviceTypeKey?: string;
  parent?: { visibilityStatus: string } | null;
};

function row(o: RowOverrides) {
  return {
    id: o.id,
    name: { en: o.en ?? o.id, ar: `${o.id}-ar` },
    slug: o.id,
    parentId: o.parentId ?? null,
    sortOrder: o.sortOrder ?? 0,
    visibilityStatus: o.visibilityStatus ?? "PUBLIC",
    serviceTypeKey: o.serviceTypeKey ?? "EXPERIENCE",
    parent: o.parent ?? null,
  };
}

afterEach(() => findManyMock.mockReset());

describe("getSelectableCategories", () => {
  it("queries with the shared selectable where-clause", async () => {
    findManyMock.mockResolvedValue([]);
    await getSelectableCategories("EXPERIENCE");
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: selectableCategoryWhere("EXPERIENCE") })
    );
  });

  it("builds a tree of effectively-selectable categories, resolving labels", async () => {
    findManyMock.mockResolvedValue([
      row({ id: "root", en: "Root" }),
      row({ id: "child", en: "Child", parentId: "root", parent: { visibilityStatus: "PUBLIC" } }),
    ]);
    const tree = await getSelectableCategories("EXPERIENCE");
    expect(tree.nodes.map((n) => n.id)).toEqual(["root"]);
    expect(tree.nodes[0]!.label).toBe("Root");
    expect(tree.nodes[0]!.children.map((n) => n.id)).toEqual(["child"]);
  });

  it("drops a PUBLIC child whose parent is HIDDEN (effective visibility)", async () => {
    findManyMock.mockResolvedValue([
      row({ id: "child", parentId: "hiddenRoot", parent: { visibilityStatus: "HIDDEN" } }),
    ]);
    const tree = await getSelectableCategories("EXPERIENCE");
    expect(tree.nodes).toEqual([]);
  });
});
