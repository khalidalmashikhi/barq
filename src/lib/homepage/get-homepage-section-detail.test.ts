import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 1.4 (Core Business Platform) — regression test for
// getHomepageSectionDetail(), mirroring get-feature-flag-detail.test.ts's
// shape.

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const findUniqueMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    homepageSection: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

const { getHomepageSectionDetail } = await import("./get-homepage-section-detail");

const SECTION_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  findUniqueMock.mockReset();
});

describe("getHomepageSectionDetail", () => {
  it("returns null for a malformed id without querying the database", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });

    const result = await getHomepageSectionDetail("not-a-uuid");

    expect(result).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("returns null when the section doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);

    const result = await getHomepageSectionDetail(SECTION_ID);

    expect(result).toBeNull();
  });

  it("returns the section detail", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({
      id: SECTION_ID,
      key: "hero_banner",
      label: "Hero Banner",
      description: "Top-of-page hero",
      visible: true,
      sortOrder: 0,
    });

    const result = await getHomepageSectionDetail(SECTION_ID);

    expect(result).toEqual({
      id: SECTION_ID,
      key: "hero_banner",
      label: "Hero Banner",
      description: "Top-of-page hero",
      visible: true,
      sortOrder: 0,
    });
  });
});
