import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 5.2 (Production Hardening) — regression tests for
// approveProvider(), extended this phase to wrap its status update and
// its new audit-log write in one transaction. Mocks requireAdmin and
// prisma the same way other action-level tests in this codebase mock
// @/lib/auth/@/lib/db (see apply-as-provider.test.ts).

vi.mock("server-only", () => ({}));

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
    provider: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        provider: { update: (...args: unknown[]) => updateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { approveProvider } = await import("./approve-provider");

afterEach(() => {
  requireAdminMock.mockReset();
  findUniqueMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("approveProvider", () => {
  it("returns PROVIDER_NOT_FOUND when the provider doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);

    const result = await approveProvider("019f4e4e-8116-7052-b15e-b79b5ccb1af9");

    expect(result).toEqual({ ok: false, error: "PROVIDER_NOT_FOUND" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns PROVIDER_NOT_PENDING for a provider not in APPLIED/UNDER_REVIEW", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: "provider-1", status: "APPROVED" });

    const result = await approveProvider("019f4e4e-8116-7052-b15e-b79b5ccb1af9");

    expect(result).toEqual({ ok: false, error: "PROVIDER_NOT_PENDING" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("updates the provider and records an audit event atomically, in the same transaction", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: "provider-1", status: "APPLIED" });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await approveProvider("019f4e4e-8116-7052-b15e-b79b5ccb1af9");

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "019f4e4e-8116-7052-b15e-b79b5ccb1af9" },
      data: expect.objectContaining({ status: "APPROVED", approvedByAdminId: "admin-1" }),
    });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "ADMIN",
        actorId: "admin-1",
        action: "provider.approved",
        entityType: "Provider",
        entityId: "019f4e4e-8116-7052-b15e-b79b5ccb1af9",
        previousValue: { status: "APPLIED" },
      }),
    });
  });

  it("returns UNKNOWN_ERROR when an unexpected exception occurs", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockRejectedValue(new Error("db unavailable"));

    const result = await approveProvider("019f4e4e-8116-7052-b15e-b79b5ccb1af9");

    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
  });
});
