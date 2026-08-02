import { describe, it, expect, vi, afterEach } from "vitest";
import { ForbiddenError } from "@/lib/auth";

// User & Access Management (Batch 5) — regression tests for customer lifecycle
// (deactivate/suspend/reactivate). Proves: User.status-only mutation, the
// privileged-role safety guard, idempotency, and same-transaction audit. The tx
// mock exposes only user.update + auditLog.create, so a passing test also shows
// no Admin/Staff/Provider/Customer/AuthUser/Session row is mutated.

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireAdmin: (...a: unknown[]) => requireAdminMock(...a),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const userFindUniqueMock = vi.fn();
const adminFindUniqueMock = vi.fn();
const staffFindUniqueMock = vi.fn();
const userUpdateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => userFindUniqueMock(...a) },
    admin: { findUnique: (...a: unknown[]) => adminFindUniqueMock(...a) },
    staff: { findUnique: (...a: unknown[]) => staffFindUniqueMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({ user: { update: (...a: unknown[]) => userUpdateMock(...a) }, auditLog: { create: (...a: unknown[]) => auditCreateMock(...a) } }),
  },
}));

const { deactivateCustomer, suspendCustomer, reactivateCustomer } = await import("./customer-lifecycle");
const ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  userFindUniqueMock.mockReset();
  adminFindUniqueMock.mockReset();
  staffFindUniqueMock.mockReset();
  userUpdateMock.mockReset();
  auditCreateMock.mockReset();
});

function asAdmin() {
  requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
  adminFindUniqueMock.mockResolvedValue(null);
  staffFindUniqueMock.mockResolvedValue(null);
}

describe("deactivateCustomer", () => {
  it("denies a non-admin caller", async () => {
    requireAdminMock.mockRejectedValue(new ForbiddenError());
    expect(await deactivateCustomer(ID)).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
  });

  it("returns USER_NOT_FOUND", async () => {
    asAdmin();
    userFindUniqueMock.mockResolvedValue(null);
    expect(await deactivateCustomer(ID)).toEqual({ ok: false, error: "USER_NOT_FOUND" });
  });

  it("is idempotent for an already-DEACTIVATED user (no privileged lookup, no mutation)", async () => {
    asAdmin();
    userFindUniqueMock.mockResolvedValue({ id: ID, status: "DEACTIVATED" });
    expect(await deactivateCustomer(ID)).toEqual({ ok: true, outcome: "already_deactivated" });
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("blocks when the same User has an ACTIVE Admin profile (USER_HAS_PRIVILEGED_ROLE)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    adminFindUniqueMock.mockResolvedValue({ status: "ACTIVE" });
    staffFindUniqueMock.mockResolvedValue(null);
    userFindUniqueMock.mockResolvedValue({ id: ID, status: "ACTIVE" });
    expect(await deactivateCustomer(ID)).toEqual({ ok: false, error: "USER_HAS_PRIVILEGED_ROLE" });
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("blocks when the same User has an ACTIVE Staff profile", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    adminFindUniqueMock.mockResolvedValue(null);
    staffFindUniqueMock.mockResolvedValue({ status: "ACTIVE" });
    userFindUniqueMock.mockResolvedValue({ id: ID, status: "ACTIVE" });
    expect(await deactivateCustomer(ID)).toEqual({ ok: false, error: "USER_HAS_PRIVILEGED_ROLE" });
  });

  it("deactivates User.status only and writes customer.deactivated audit in the same transaction", async () => {
    asAdmin();
    userFindUniqueMock.mockResolvedValue({ id: ID, status: "ACTIVE" });
    userUpdateMock.mockResolvedValue({});

    const result = await deactivateCustomer(ID);

    expect(result).toEqual({ ok: true, outcome: "deactivated" });
    expect(userUpdateMock).toHaveBeenCalledWith({ where: { id: ID }, data: { status: "DEACTIVATED" } });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "customer.deactivated", entityType: "User", entityId: ID, newValue: { status: "DEACTIVATED" } }),
    });
  });
});

describe("suspendCustomer", () => {
  it("suspends an ACTIVE user (User.status only) with the privileged guard applied", async () => {
    asAdmin();
    userFindUniqueMock.mockResolvedValue({ id: ID, status: "ACTIVE" });
    userUpdateMock.mockResolvedValue({});
    const result = await suspendCustomer(ID);
    expect(result).toEqual({ ok: true, outcome: "suspended" });
    expect(userUpdateMock).toHaveBeenCalledWith({ where: { id: ID }, data: { status: "SUSPENDED" } });
    expect(auditCreateMock).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "customer.suspended" }) });
  });

  it("is idempotent for an already-SUSPENDED user", async () => {
    asAdmin();
    userFindUniqueMock.mockResolvedValue({ id: ID, status: "SUSPENDED" });
    expect(await suspendCustomer(ID)).toEqual({ ok: true, outcome: "already_suspended" });
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("blocks a privileged-role user", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    adminFindUniqueMock.mockResolvedValue({ status: "ACTIVE" });
    staffFindUniqueMock.mockResolvedValue(null);
    userFindUniqueMock.mockResolvedValue({ id: ID, status: "ACTIVE" });
    expect(await suspendCustomer(ID)).toEqual({ ok: false, error: "USER_HAS_PRIVILEGED_ROLE" });
  });
});

describe("reactivateCustomer", () => {
  it("reactivates a DEACTIVATED user (no privileged guard) and writes customer.reactivated audit", async () => {
    asAdmin();
    userFindUniqueMock.mockResolvedValue({ id: ID, status: "DEACTIVATED" });
    userUpdateMock.mockResolvedValue({});
    const result = await reactivateCustomer(ID);
    expect(result).toEqual({ ok: true, outcome: "reactivated" });
    expect(userUpdateMock).toHaveBeenCalledWith({ where: { id: ID }, data: { status: "ACTIVE" } });
    expect(auditCreateMock).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "customer.reactivated", newValue: { status: "ACTIVE" } }) });
  });

  it("is idempotent for an already-ACTIVE user", async () => {
    asAdmin();
    userFindUniqueMock.mockResolvedValue({ id: ID, status: "ACTIVE" });
    expect(await reactivateCustomer(ID)).toEqual({ ok: true, outcome: "already_active" });
    expect(userUpdateMock).not.toHaveBeenCalled();
  });
});
