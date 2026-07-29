import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 1.3 (Core Business Platform) — regression test for
// isFeatureEnabled(), the unauthenticated read helper other app code calls.

vi.mock("server-only", () => ({}));

const findUniqueMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    featureFlag: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

const { isFeatureEnabled } = await import("./is-feature-enabled");

afterEach(() => {
  findUniqueMock.mockReset();
});

describe("isFeatureEnabled", () => {
  it("returns true when the flag exists and is enabled", async () => {
    findUniqueMock.mockResolvedValue({ enabled: true });

    expect(await isFeatureEnabled("new_checkout_flow")).toBe(true);
    expect(findUniqueMock).toHaveBeenCalledWith({ where: { key: "new_checkout_flow" }, select: { enabled: true } });
  });

  it("returns false when the flag exists and is disabled", async () => {
    findUniqueMock.mockResolvedValue({ enabled: false });

    expect(await isFeatureEnabled("new_checkout_flow")).toBe(false);
  });

  it("returns false when no flag with that key exists at all", async () => {
    findUniqueMock.mockResolvedValue(null);

    expect(await isFeatureEnabled("nonexistent_flag")).toBe(false);
  });
});
