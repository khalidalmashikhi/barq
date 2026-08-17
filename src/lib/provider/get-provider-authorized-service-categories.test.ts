import { describe, it, expect, vi, afterEach } from "vitest";

// Gate B5 — the provider service picker source: authorized ∩ assignable. It
// intersects the provider's ProviderCategory links (any provenance) with the
// assignable-category rule (effectively-PUBLIC + governed vertical), so the
// picker never offers a category the provider can't actually use. It is a UX
// affordance, not the security boundary (the domain actions re-check).

vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", () => ({ getLocale: () => Promise.resolve("en") }));
vi.mock("@/lib/i18n/extract-localized-text", () => ({
  extractLocalizedText: (v: { en?: string }) => v?.en ?? "",
}));

const providerCategoryFindManyMock = vi.fn();
const categoryFindManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    providerCategory: { findMany: (...a: unknown[]) => providerCategoryFindManyMock(...a) },
    category: { findMany: (...a: unknown[]) => categoryFindManyMock(...a) },
  },
}));

const { getProviderAuthorizedServiceCategories } = await import("./get-provider-authorized-service-categories");

const PROVIDER = "prov-1";

// A minimal assignable-universe row (effectively-PUBLIC + governed vertical).
const pub = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: { en: id },
  slug: id,
  parentId: null,
  sortOrder: 0,
  visibilityStatus: "PUBLIC",
  serviceTypeKey: "EXPERIENCE",
  parent: null,
  ...extra,
});

afterEach(() => {
  providerCategoryFindManyMock.mockReset();
  categoryFindManyMock.mockReset();
});

describe("getProviderAuthorizedServiceCategories", () => {
  it("returns only categories that are BOTH authorized and assignable (the intersection)", async () => {
    providerCategoryFindManyMock.mockResolvedValue([{ categoryId: "cat-a" }, { categoryId: "cat-c" }]);
    categoryFindManyMock.mockResolvedValue([pub("cat-a"), pub("cat-b"), pub("cat-c")]);

    const tree = await getProviderAuthorizedServiceCategories(PROVIDER);

    const ids = tree.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["cat-a", "cat-c"]); // cat-b assignable but NOT authorized → excluded
  });

  it("scopes the authorized query to the provider and never accepts a client set", async () => {
    providerCategoryFindManyMock.mockResolvedValue([]);
    await getProviderAuthorizedServiceCategories(PROVIDER);
    expect(providerCategoryFindManyMock).toHaveBeenCalledWith({
      where: { providerId: PROVIDER },
      select: { categoryId: true },
    });
  });

  it("returns an empty picker WITHOUT querying categories when the provider has no authorized activities", async () => {
    providerCategoryFindManyMock.mockResolvedValue([]);

    const tree = await getProviderAuthorizedServiceCategories(PROVIDER);

    expect(tree.nodes).toEqual([]);
    expect(categoryFindManyMock).not.toHaveBeenCalled();
  });

  it("excludes an authorized category that is NOT effectively visible (authorized but not assignable)", async () => {
    // Provider holds a link for cat-x, but cat-x's parent is HIDDEN → not
    // effectively visible → not assignable → must not appear in the picker.
    providerCategoryFindManyMock.mockResolvedValue([{ categoryId: "cat-x" }]);
    categoryFindManyMock.mockResolvedValue([
      pub("cat-x", { parentId: "p", parent: { visibilityStatus: "HIDDEN" } }),
    ]);

    const tree = await getProviderAuthorizedServiceCategories(PROVIDER);

    expect(tree.nodes).toEqual([]);
  });
});
