import { describe, it, expect, vi, afterEach } from "vitest";
import { ForbiddenError } from "@/lib/auth";

// User & Access Management (Batch 5) — regression tests for reactivateProvider().
// Confirms it un-suspends only (SUSPENDED -> APPROVED) and never un-archives a
// terminal DEACTIVATED provider.

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireAdmin: (...a: unknown[]) => requireAdminMock(...a),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const findUniqueMock = vi.fn();
const updateMock = vi.fn();
const auditCreateMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    provider: { findUnique: (...a: unknown[]) => findUniqueMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({ provider: { update: (...a: unknown[]) => updateMock(...a) }, auditLog: { create: (...a: unknown[]) => auditCreateMock(...a) } }),
  },
}));

const { reactivateProvider } = await import("./reactivate-provider");
const ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  findUniqueMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("reactivateProvider", () => {
  it("denies a non-admin caller", async () => {
    requireAdminMock.mockRejectedValue(new ForbiddenError());
    expect(await reactivateProvider(ID)).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
  });

  it("is idempotent for an already-APPROVED provider", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: ID, status: "APPROVED" });
    expect(await reactivateProvider(ID)).toEqual({ ok: true, outcome: "already_active" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it.each(["DEACTIVATED", "APPLIED", "UNDER_REVIEW"])("rejects reactivation from %s (DEACTIVATED is terminal)", async (status) => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: ID, status });
    expect(await reactivateProvider(ID)).toEqual({ ok: false, error: "INVALID_STATUS_TRANSITION" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("reactivates a SUSPENDED provider to APPROVED and writes provider.reactivated audit", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: ID, status: "SUSPENDED" });
    updateMock.mockResolvedValue({});

    const result = await reactivateProvider(ID);

    expect(result).toEqual({ ok: true, outcome: "reactivated" });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: ID }, data: { status: "APPROVED" } });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "provider.reactivated", previousValue: { status: "SUSPENDED" }, newValue: { status: "APPROVED" } }),
    });
  });
});
