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
