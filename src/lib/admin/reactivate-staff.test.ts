import { describe, it, expect, vi, afterEach } from "vitest";
import { ForbiddenError } from "@/lib/auth";

// User & Access Management (Batch 4) — regression tests for reactivateStaff().

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
    staff: { findUnique: (...args: unknown[]) => findUniqueMock(...args) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        staff: { update: (...args: unknown[]) => updateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { reactivateStaff } = await import("./reactivate-staff");
const ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  findUniqueMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("reactivateStaff", () => {
  it("denies a non-admin caller", async () => {
    requireAdminMock.mockRejectedValue(new ForbiddenError());
    expect(await reactivateStaff(ID)).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
  });

  it("returns STAFF_NOT_FOUND when missing", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);
    expect(await reactivateStaff(ID)).toEqual({ ok: false, error: "STAFF_NOT_FOUND" });
  });

  it("is idempotent for an already-ACTIVE staff", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: ID, status: "ACTIVE", roles: ["SUPPORT"], user: { status: "ACTIVE" } });
    expect(await reactivateStaff(ID)).toEqual({ ok: true, outcome: "already_active" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("refuses reactivation when the underlying User is SUSPENDED/DEACTIVATED", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: ID, status: "DEACTIVATED", roles: ["SUPPORT"], user: { status: "DEACTIVATED" } });
    expect(await reactivateStaff(ID)).toEqual({ ok: false, error: "USER_INACTIVE" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("reactivates a DEACTIVATED staff, preserving roles, and writes staff.reactivated audit", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: ID, status: "DEACTIVATED", roles: ["SUPPORT", "FINANCE"], user: { status: "VERIFIED" } });
    updateMock.mockResolvedValue({});

    const result = await reactivateStaff(ID);

    expect(result).toEqual({ ok: true, outcome: "reactivated" });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: ID }, data: { status: "ACTIVE" } });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "staff.reactivated", newValue: { status: "ACTIVE", roles: ["SUPPORT", "FINANCE"] } }),
    });
  });
});
