import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 1.3 (Core Business Platform) — regression tests for
// createFeatureFlag(), mirroring create-category.test.ts's shape.

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
const createMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    featureFlag: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        featureFlag: { create: (...args: unknown[]) => createMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { createFeatureFlag } = await import("./create-feature-flag");

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
  createMock.mockReset();
  auditCreateMock.mockReset();
});

describe("createFeatureFlag", () => {
  it("returns INVALID_INPUT for a malformed key without checking admin status", async () => {
    const result = await createFeatureFlag(buildFormData({ key: "Not A Valid Key!", description: "" }));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns NO_ADMIN_PROFILE when the caller has no Admin profile", async () => {
    const { ForbiddenError } = await import("@/lib/auth");
    requireAdminMock.mockRejectedValue(new ForbiddenError("Admin role required"));

    const result = await createFeatureFlag(buildFormData({ key: "new_checkout_flow", description: "" }));

    expect(result).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns KEY_TAKEN without creating anything when the key already exists", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: "existing-flag" });

    const result = await createFeatureFlag(buildFormData({ key: "new_checkout_flow", description: "" }));

    expect(result).toEqual({ ok: false, error: "KEY_TAKEN" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("creates the flag disabled by default and records an audit event", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);
    createMock.mockResolvedValue({ id: "flag-1" });
    auditCreateMock.mockResolvedValue({});

    const result = await createFeatureFlag(
      buildFormData({ key: "new_checkout_flow", description: "Gates the redesigned checkout" })
    );

    expect(result).toEqual({ ok: true, flagId: "flag-1" });
    expect(createMock).toHaveBeenCalledWith({
      data: { key: "new_checkout_flow", description: "Gates the redesigned checkout" },
    });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "ADMIN",
        actorId: "admin-1",
        action: "feature_flag.created",
        entityType: "FeatureFlag",
        entityId: "flag-1",
        newValue: expect.objectContaining({ enabled: false }),
      }),
    });
  });
});
