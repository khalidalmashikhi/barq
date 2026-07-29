import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 1.3 (Core Business Platform) — regression tests for
// updateFeatureFlag(), mirroring update-category.test.ts's shape. Only
// `description` is mutable — confirms `key` is never touched.

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

const { updateFeatureFlag } = await import("./update-feature-flag");

const FLAG_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

afterEach(() => {
  requireAdminMock.mockReset();
  findUniqueMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("updateFeatureFlag", () => {
  it("returns FLAG_NOT_FOUND when the flag doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);

    const result = await updateFeatureFlag(FLAG_ID, buildFormData({ description: "New description" }));

    expect(result).toEqual({ ok: false, error: "FLAG_NOT_FOUND" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("updates only the description, never the key", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: FLAG_ID, key: "new_checkout_flow", description: "Old" });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await updateFeatureFlag(FLAG_ID, buildFormData({ description: "New description" }));

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: FLAG_ID },
      data: { description: "New description" },
    });
    expect(updateMock.mock.calls[0]?.[0].data).not.toHaveProperty("key");
  });
});
