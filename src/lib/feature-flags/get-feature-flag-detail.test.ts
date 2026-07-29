import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 1.3 (Core Business Platform) — regression test for
// getFeatureFlagDetail().

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const findUniqueMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    featureFlag: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

const { getFeatureFlagDetail } = await import("./get-feature-flag-detail");

const FLAG_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  findUniqueMock.mockReset();
});

describe("getFeatureFlagDetail", () => {
  it("returns null for a malformed id without querying the database", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });

    const result = await getFeatureFlagDetail("not-a-uuid");

    expect(result).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("returns null when the flag doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);

    const result = await getFeatureFlagDetail(FLAG_ID);

    expect(result).toBeNull();
  });

  it("returns the flag detail", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({
      id: FLAG_ID,
      key: "new_checkout_flow",
      enabled: true,
      description: "Gates the redesigned checkout",
    });

    const result = await getFeatureFlagDetail(FLAG_ID);

    expect(result).toEqual({
      id: FLAG_ID,
      key: "new_checkout_flow",
      enabled: true,
      description: "Gates the redesigned checkout",
    });
  });
});
