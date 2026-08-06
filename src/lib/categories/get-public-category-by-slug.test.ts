import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const findFirstMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { category: { findFirst: (...args: unknown[]) => findFirstMock(...args) } },
}));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));

const { getPublicCategoryBySlug } = await import("./get-public-category-by-slug");
const { publicCategoryWhere } = await import("./public-category-rule");

afterEach(() => findFirstMock.mockReset());

describe("publicCategoryWhere", () => {
  it("filters to own PUBLIC status only (no serviceType scope — browse spans verticals)", () => {
    expect(publicCategoryWhere()).toEqual({ visibilityStatus: "PUBLIC" });
  });
});

describe("getPublicCategoryBySlug", () => {
  it("queries by slug scoped to the shared PUBLIC rule", async () => {
    findFirstMock.mockResolvedValue(null);
    await getPublicCategoryBySlug("diving");
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ slug: "diving", visibilityStatus: "PUBLIC" }) })
    );
  });

  it("resolves a PUBLIC root category to id + locale-resolved label", async () => {
    findFirstMock.mockResolvedValue({
      id: "cat-1",
      slug: "diving",
      name: { en: "Diving", ar: "الغوص" },
      visibilityStatus: "PUBLIC",
      parent: null,
    });
    expect(await getPublicCategoryBySlug("diving")).toEqual({ id: "cat-1", slug: "diving", label: "Diving" });
  });

  it("resolves a PUBLIC child under a PUBLIC parent", async () => {
    findFirstMock.mockResolvedValue({
      id: "cat-2",
      slug: "reef-dives",
      name: { en: "Reef Dives" },
      visibilityStatus: "PUBLIC",
      parent: { visibilityStatus: "PUBLIC" },
    });
    expect(await getPublicCategoryBySlug("reef-dives")).toMatchObject({ id: "cat-2", label: "Reef Dives" });
  });

  it("returns null for an unknown slug (fall back to keyword bridge)", async () => {
    findFirstMock.mockResolvedValue(null);
    expect(await getPublicCategoryBySlug("made-up")).toBeNull();
  });

  it("returns null for a PUBLIC child under a HIDDEN parent (effective visibility)", async () => {
    findFirstMock.mockResolvedValue({
      id: "cat-3",
      slug: "hidden-branch-child",
      name: { en: "Child" },
      visibilityStatus: "PUBLIC",
      parent: { visibilityStatus: "HIDDEN" },
    });
    expect(await getPublicCategoryBySlug("hidden-branch-child")).toBeNull();
  });

  it("falls back to the slug when the label has no usable localized value", async () => {
    findFirstMock.mockResolvedValue({
      id: "cat-4",
      slug: "empty-label",
      name: {},
      visibilityStatus: "PUBLIC",
      parent: null,
    });
    expect(await getPublicCategoryBySlug("empty-label")).toEqual({ id: "cat-4", slug: "empty-label", label: "empty-label" });
  });
});
