import { describe, it, expect, vi, afterEach } from "vitest";
import { ForbiddenError } from "@/lib/auth";

// User & Access Management (Batch 5) — regression tests for suspendProvider().

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

const { suspendProvider } = await import("./suspend-provider");
const ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  findUniqueMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("suspendProvider", () => {
  it("denies a non-admin / inactive-admin caller", async () => {
    requireAdminMock.mockRejectedValue(new ForbiddenError());
    expect(await suspendProvider(ID)).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
  });

  it("returns PROVIDER_NOT_FOUND", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);
    expect(await suspendProvider(ID)).toEqual({ ok: false, error: "PROVIDER_NOT_FOUND" });
  });

  it("is idempotent for an already-SUSPENDED provider", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: ID, status: "SUSPENDED" });
    expect(await suspendProvider(ID)).toEqual({ ok: true, outcome: "already_suspended" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it.each(["APPLIED", "UNDER_REVIEW", "DEACTIVATED"])("rejects an invalid transition from %s", async (status) => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: ID, status });
    expect(await suspendProvider(ID)).toEqual({ ok: false, error: "INVALID_STATUS_TRANSITION" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("suspends an APPROVED provider and writes provider.suspended audit in the same transaction", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: ID, status: "APPROVED" });
    updateMock.mockResolvedValue({});

    const result = await suspendProvider(ID);

    expect(result).toEqual({ ok: true, outcome: "suspended" });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: ID }, data: { status: "SUSPENDED" } });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "provider.suspended", previousValue: { status: "APPROVED" }, newValue: { status: "SUSPENDED" } }),
    });
  });
});
