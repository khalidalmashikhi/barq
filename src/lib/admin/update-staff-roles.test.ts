import { describe, it, expect, vi, afterEach } from "vitest";
import { ForbiddenError } from "@/lib/auth";

// User & Access Management (Batch 4) — regression tests for updateStaffRoles().

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

const { updateStaffRoles } = await import("./update-staff-roles");
const ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  findUniqueMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("updateStaffRoles", () => {
  it("denies a non-admin caller", async () => {
    requireAdminMock.mockRejectedValue(new ForbiddenError());
    expect(await updateStaffRoles(ID, ["SUPPORT"])).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
  });

  it("rejects a non-UUID id, empty roles and invalid roles", async () => {
    expect(await updateStaffRoles("nope", ["SUPPORT"])).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await updateStaffRoles(ID, [])).toEqual({ ok: false, error: "EMPTY_ROLES" });
    expect(await updateStaffRoles(ID, ["NOPE"])).toEqual({ ok: false, error: "INVALID_ROLE" });
  });

  it("returns STAFF_NOT_FOUND when the staff row is missing", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);
    expect(await updateStaffRoles(ID, ["SUPPORT"])).toEqual({ ok: false, error: "STAFF_NOT_FOUND" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("is idempotent (already_current) when the role set is unchanged", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: ID, roles: ["SUPPORT", "FINANCE"] });
    expect(await updateStaffRoles(ID, ["FINANCE", "SUPPORT"])).toEqual({ ok: true, outcome: "already_current" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("replaces the role set (canonical order) and writes staff.roles_updated audit", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: ID, roles: ["SUPPORT"] });
    updateMock.mockResolvedValue({});

    const result = await updateStaffRoles(ID, ["FINANCE", "OPERATIONS"]);

    expect(result).toEqual({ ok: true, outcome: "roles_updated" });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: ID }, data: { roles: ["OPERATIONS", "FINANCE"] } });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "staff.roles_updated", previousValue: { roles: ["SUPPORT"] }, newValue: { roles: ["OPERATIONS", "FINANCE"] } }),
    });
  });
});
