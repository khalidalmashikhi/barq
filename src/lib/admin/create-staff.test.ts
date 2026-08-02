import { describe, it, expect, vi, afterEach } from "vitest";
import { ForbiddenError } from "@/lib/auth";

// User & Access Management (Batch 4) — regression tests for createStaff().

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const userFindUniqueMock = vi.fn();
const staffCreateMock = vi.fn();
const staffUpdateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        staff: {
          create: (...args: unknown[]) => staffCreateMock(...args),
          update: (...args: unknown[]) => staffUpdateMock(...args),
        },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { createStaff } = await import("./create-staff");

afterEach(() => {
  requireAdminMock.mockReset();
  userFindUniqueMock.mockReset();
  staffCreateMock.mockReset();
  staffUpdateMock.mockReset();
  auditCreateMock.mockReset();
});

const VERIFIED_USER = { id: "user-1", phoneNumberVerified: true, status: "VERIFIED", staff: null };

describe("createStaff", () => {
  it("denies a non-admin / inactive-admin caller", async () => {
    requireAdminMock.mockRejectedValue(new ForbiddenError());
    expect(await createStaff("+96890000001", ["SUPPORT"])).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
  });

  it("rejects an empty role selection", async () => {
    expect(await createStaff("+96890000001", [])).toEqual({ ok: false, error: "EMPTY_ROLES" });
  });

  it("rejects an invalid role", async () => {
    expect(await createStaff("+96890000001", ["MANAGER"])).toEqual({ ok: false, error: "INVALID_ROLE" });
  });

  it("returns USER_NOT_FOUND / USER_NOT_VERIFIED / USER_INACTIVE", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    userFindUniqueMock.mockResolvedValueOnce(null);
    expect(await createStaff("+96890000001", ["SUPPORT"])).toEqual({ ok: false, error: "USER_NOT_FOUND" });

    userFindUniqueMock.mockResolvedValueOnce({ ...VERIFIED_USER, phoneNumberVerified: false });
    expect(await createStaff("+96890000001", ["SUPPORT"])).toEqual({ ok: false, error: "USER_NOT_VERIFIED" });

    userFindUniqueMock.mockResolvedValueOnce({ ...VERIFIED_USER, status: "DEACTIVATED" });
    expect(await createStaff("+96890000001", ["SUPPORT"])).toEqual({ ok: false, error: "USER_INACTIVE" });
    expect(staffCreateMock).not.toHaveBeenCalled();
  });

  it("creates staff with one role and writes a staff.created audit event", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    userFindUniqueMock.mockResolvedValue({ ...VERIFIED_USER });
    staffCreateMock.mockResolvedValue({ id: "staff-new" });

    const result = await createStaff("+96890000001", ["SUPPORT"]);

    expect(result).toEqual({ ok: true, outcome: "created" });
    expect(staffCreateMock).toHaveBeenCalledWith({ data: { userId: "user-1", roles: ["SUPPORT"], status: "ACTIVE" } });
    expect(auditCreateMock).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "staff.created", actorId: "admin-1" }) });
  });

  it("creates staff with multiple roles in canonical order (dedup applied)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    userFindUniqueMock.mockResolvedValue({ ...VERIFIED_USER });
    staffCreateMock.mockResolvedValue({ id: "staff-new" });

    await createStaff("+96890000001", ["FINANCE", "OPERATIONS", "OPERATIONS"]);

    expect(staffCreateMock).toHaveBeenCalledWith({ data: { userId: "user-1", roles: ["OPERATIONS", "FINANCE"], status: "ACTIVE" } });
  });

  it("is idempotent (already_current) for existing ACTIVE staff with the same role set — no duplicate row", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    userFindUniqueMock.mockResolvedValue({ ...VERIFIED_USER, staff: { id: "staff-1", status: "ACTIVE", roles: ["SUPPORT"] } });

    const result = await createStaff("+96890000001", ["SUPPORT"]);

    expect(result).toEqual({ ok: true, outcome: "already_current" });
    expect(staffCreateMock).not.toHaveBeenCalled();
    expect(staffUpdateMock).not.toHaveBeenCalled();
  });

  it("updates roles (roles_updated) for existing ACTIVE staff with a different role set", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    userFindUniqueMock.mockResolvedValue({ ...VERIFIED_USER, staff: { id: "staff-1", status: "ACTIVE", roles: ["SUPPORT"] } });
    staffUpdateMock.mockResolvedValue({});

    const result = await createStaff("+96890000001", ["OPERATIONS", "SUPPORT"]);

    expect(result).toEqual({ ok: true, outcome: "roles_updated" });
    expect(staffUpdateMock).toHaveBeenCalledWith({ where: { id: "staff-1" }, data: { roles: ["OPERATIONS", "SUPPORT"] } });
    expect(staffCreateMock).not.toHaveBeenCalled();
    expect(auditCreateMock).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "staff.roles_updated" }) });
  });

  it("reactivates a DEACTIVATED staff and applies the requested roles in one transaction", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    userFindUniqueMock.mockResolvedValue({ ...VERIFIED_USER, staff: { id: "staff-1", status: "DEACTIVATED", roles: ["FINANCE"] } });
    staffUpdateMock.mockResolvedValue({});

    const result = await createStaff("+96890000001", ["SUPPORT"]);

    expect(result).toEqual({ ok: true, outcome: "reactivated" });
    expect(staffUpdateMock).toHaveBeenCalledWith({ where: { id: "staff-1" }, data: { status: "ACTIVE", roles: ["SUPPORT"] } });
    expect(auditCreateMock).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "staff.reactivated" }) });
  });
});
