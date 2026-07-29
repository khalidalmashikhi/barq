import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 1.3 (Core Business Platform) — regression tests for
// enableFeatureFlag()/disableFeatureFlag().

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const findUniqueMock = vi.fn();
const updateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    featureFlag: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        featureFlag: { update: (...args: unknown[]) => updateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { enableFeatureFlag, disableFeatureFlag } = await import("./toggle-feature-flag");

const FLAG_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  findUniqueMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("enableFeatureFlag", () => {
  it("sets enabled=true and records action feature_flag.enabled", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: FLAG_ID, enabled: false });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await enableFeatureFlag(FLAG_ID);

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: FLAG_ID }, data: { enabled: true } });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "feature_flag.enabled", newValue: { enabled: true } }),
    });
  });

  it("returns FLAG_NOT_FOUND when the flag doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);

    const result = await enableFeatureFlag(FLAG_ID);

    expect(result).toEqual({ ok: false, error: "FLAG_NOT_FOUND" });
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("disableFeatureFlag", () => {
  it("sets enabled=false and records action feature_flag.disabled", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: FLAG_ID, enabled: true });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await disableFeatureFlag(FLAG_ID);

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: FLAG_ID }, data: { enabled: false } });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "feature_flag.disabled", newValue: { enabled: false } }),
    });
  });
});
