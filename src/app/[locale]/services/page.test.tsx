import { describe, it, expect, vi, afterEach } from "vitest";

// B2 Slice 1 — dual-read behaviour on /services. Asserts that ?category=<slug>
// resolves to a real PUBLIC category first (→ relational categoryId filter),
// and falls back to the legacy keyword bridge only when it is NOT a public
// category. Data/i18n deps are mocked; the child components are only rendered
// as element types (never executed), so this stays a focused unit test.

vi.mock("server-only", () => ({}));

const getServicesMock = vi.fn();
const getProvidersForFilterMock = vi.fn();
vi.mock("@/lib/services/get-services", () => ({
  getServices: (...args: unknown[]) => getServicesMock(...args),
  getProvidersForFilter: (...args: unknown[]) => getProvidersForFilterMock(...args),
}));

const getPublicCategoryBySlugMock = vi.fn();
vi.mock("@/lib/categories/get-public-category-by-slug", () => ({
  getPublicCategoryBySlug: (...args: unknown[]) => getPublicCategoryBySlugMock(...args),
}));

vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: async () => (key: string) => key,
}));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/i18n/navigation", () => ({ getPathname: () => "/services" }));
vi.mock("@/lib/i18n/metadata", () => ({ buildLocalizedMetadata: () => ({}) }));

const { default: ServicesPage } = await import("./page");

function emptyResult() {
  return { items: [], totalCount: 0, page: 1, pageSize: 12, totalPages: 1 };
}

async function render(category: string | undefined) {
  getProvidersForFilterMock.mockResolvedValue([]);
  getServicesMock.mockResolvedValue(emptyResult());
  await ServicesPage({ searchParams: Promise.resolve(category === undefined ? {} : { category }) });
  return getServicesMock.mock.calls[0]![0] as { categoryId?: string; categoryKeyword?: string };
}

afterEach(() => {
  getServicesMock.mockReset();
  getProvidersForFilterMock.mockReset();
  getPublicCategoryBySlugMock.mockReset();
});

describe("ServicesPage — dual-read category resolution", () => {
  it("filters by relational categoryId when the slug resolves to a PUBLIC category", async () => {
    getPublicCategoryBySlugMock.mockResolvedValue({ id: "cat-1", slug: "diving", label: "Diving" });

    const args = await render("diving");

    expect(getPublicCategoryBySlugMock).toHaveBeenCalledWith("diving");
    expect(args.categoryId).toBe("cat-1");
    expect(args.categoryKeyword).toBeUndefined();
  });

  it("falls back to the legacy keyword bridge when the slug is NOT a public category", async () => {
    getPublicCategoryBySlugMock.mockResolvedValue(null);

    // "diving" is a known legacy DASHBOARD slug → resolveCategoryLabel returns
    // t("categoryDiving") (identity-mocked to the key itself).
    const args = await render("diving");

    expect(args.categoryId).toBeUndefined();
    expect(args.categoryKeyword).toBe("categoryDiving");
  });

  it("passes neither category filter, and never calls the resolver, when no category slug is present", async () => {
    const args = await render(undefined);

    expect(getPublicCategoryBySlugMock).not.toHaveBeenCalled();
    expect(args.categoryId).toBeUndefined();
    expect(args.categoryKeyword).toBeUndefined();
  });
});

// HOME-1 — ?group=<KEY> resolves via the app-owned discovery registry to the
// group's REAL public category ids (never a label/serviceTypeKey), which the
// reader ANDs in as categoryIds. MORE/unknown → no group filter (browse all).
describe("ServicesPage — discovery-group (?group=) resolution", () => {
  async function renderGroup(group: string) {
    getProvidersForFilterMock.mockResolvedValue([]);
    getServicesMock.mockResolvedValue(emptyResult());
    // Every discovery slug resolves to a fake public category id.
    getPublicCategoryBySlugMock.mockImplementation(async (slug: string) => ({ id: `id-${slug}`, slug, label: slug }));
    await ServicesPage({ searchParams: Promise.resolve({ group }) });
    return getServicesMock.mock.calls[0]![0] as { categoryIds?: string[] };
  }

  it("EXPERIENCES spans its three real category ids (a multi-slug group)", async () => {
    const args = await renderGroup("EXPERIENCES");
    expect(args.categoryIds).toEqual(["id-adventures", "id-local-experiences", "id-cultural-tours"]);
  });

  it("TOURIST_GUIDES resolves to exactly its own category id (not folded into Experiences)", async () => {
    const args = await renderGroup("TOURIST_GUIDES");
    expect(args.categoryIds).toEqual(["id-tourist-guides"]);
  });

  it("MORE is the browse-everything catch-all — no group filter", async () => {
    const args = await renderGroup("MORE");
    expect(getPublicCategoryBySlugMock).not.toHaveBeenCalled();
    expect(args.categoryIds).toBeUndefined();
  });

  it("an unknown group key fails closed to no group filter (never an unfiltered dump masquerading as a bucket)", async () => {
    const args = await renderGroup("NOT_A_GROUP");
    expect(args.categoryIds).toBeUndefined();
  });

  it("drops slugs that do not resolve to a public category (only real ids reach the reader)", async () => {
    getProvidersForFilterMock.mockResolvedValue([]);
    getServicesMock.mockResolvedValue(emptyResult());
    getPublicCategoryBySlugMock.mockImplementation(async (slug: string) =>
      slug === "adventures" ? { id: "id-adventures", slug, label: slug } : null,
    );
    await ServicesPage({ searchParams: Promise.resolve({ group: "EXPERIENCES" }) });
    const args = getServicesMock.mock.calls[0]![0] as { categoryIds?: string[] };
    expect(args.categoryIds).toEqual(["id-adventures"]);
  });
});
