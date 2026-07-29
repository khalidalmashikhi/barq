import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 1.5 (Homepage Rendering) — regression tests for
// getHomepageSectionRenderOrder(), the function that decides whether the
// public homepage renders its default static order or a database-driven
// one, gated by the `homepage_dynamic_sections` feature flag.

vi.mock("server-only", () => ({}));

const isFeatureEnabledMock = vi.fn();

vi.mock("@/lib/feature-flags/is-feature-enabled", () => ({
  isFeatureEnabled: (...args: unknown[]) => isFeatureEnabledMock(...args),
}));

const findManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    homepageSection: {
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}));

const { getHomepageSectionRenderOrder, HOMEPAGE_DYNAMIC_SECTIONS_FLAG_KEY } = await import(
  "./get-homepage-section-render-order"
);

const DEFAULT_KEYS = ["hero", "featured_experiences", "categories"] as const;

afterEach(() => {
  isFeatureEnabledMock.mockReset();
  findManyMock.mockReset();
});

describe("getHomepageSectionRenderOrder", () => {
  it("returns the default order unchanged when the flag is disabled, without querying the database", async () => {
    isFeatureEnabledMock.mockResolvedValue(false);

    const result = await getHomepageSectionRenderOrder(DEFAULT_KEYS);

    expect(result).toEqual([...DEFAULT_KEYS]);
    expect(isFeatureEnabledMock).toHaveBeenCalledWith(HOMEPAGE_DYNAMIC_SECTIONS_FLAG_KEY);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("returns the default order when the flag is enabled but no section is visible yet", async () => {
    isFeatureEnabledMock.mockResolvedValue(true);
    findManyMock.mockResolvedValue([]);

    const result = await getHomepageSectionRenderOrder(DEFAULT_KEYS);

    expect(result).toEqual([...DEFAULT_KEYS]);
  });

  it("returns the database-driven order when the flag is enabled and sections are visible", async () => {
    isFeatureEnabledMock.mockResolvedValue(true);
    findManyMock.mockResolvedValue([{ key: "categories" }, { key: "hero" }]);

    const result = await getHomepageSectionRenderOrder(DEFAULT_KEYS);

    expect(result).toEqual(["categories", "hero"]);
    expect(findManyMock).toHaveBeenCalledWith({
      where: { visible: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { key: true },
    });
  });

  it("silently drops database keys that don't match any known default key", async () => {
    isFeatureEnabledMock.mockResolvedValue(true);
    findManyMock.mockResolvedValue([{ key: "categories" }, { key: "some_removed_section" }]);

    const result = await getHomepageSectionRenderOrder(DEFAULT_KEYS);

    expect(result).toEqual(["categories"]);
  });

  it("falls back to the default order when the database query throws", async () => {
    isFeatureEnabledMock.mockResolvedValue(true);
    findManyMock.mockRejectedValue(new Error("connection refused"));

    const result = await getHomepageSectionRenderOrder(DEFAULT_KEYS);

    expect(result).toEqual([...DEFAULT_KEYS]);
  });
});
