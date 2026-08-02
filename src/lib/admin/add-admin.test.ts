import { describe, it, expect, vi, afterEach } from "vitest";
import { ForbiddenError } from "@/lib/auth";

// User & Access Management (Batch 3) — regression tests for addAdmin().
// Mocks requireAdmin/prisma the same way approve-provider.test.ts does; the
// real recordAuditEvent runs against the mocked tx.auditLog.create so the
// same-transaction audit write is exercised, not stubbed away.

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const userFindUniqueMock = vi.fn();
const adminCreateMock = vi.fn();
const adminUpdateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        admin: {
          create: (...args: unknown[]) => adminCreateMock(...args),
          update: (...args: unknown[]) => adminUpdateMock(...args),
        },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { addAdmin } = await import("./add-admin");

afterEach(() => {
  requireAdminMock.mockReset();
  userFindUniqueMock.mockReset();
  adminCreateMock.mockReset();
  adminUpdateMock.mockReset();
  auditCreateMock.mockReset();
});

const VERIFIED_USER = { id: "user-1", phoneNumberVerified: true, status: "VERIFIED", admin: null };

describe("addAdmin", () => {
  it("denies a non-admin (or inactive-admin, denied by requireAdmin under Batch 1) caller", async () => {
    requireAdminMock.mockRejectedValue(new ForbiddenError());
    const result = await addAdmin("+96890000001");
    expect(result).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
    expect(userFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT for an empty phone", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    expect(await addAdmin("   ")).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("returns USER_NOT_FOUND when no user has that phone", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    userFindUniqueMock.mockResolvedValue(null);
    expect(await addAdmin("+96890000001")).toEqual({ ok: false, error: "USER_NOT_FOUND" });
    expect(adminCreateMock).not.toHaveBeenCalled();
  });

  it("returns USER_NOT_VERIFIED for an unverified user", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    userFindUniqueMock.mockResolvedValue({ ...VERIFIED_USER, phoneNumberVerified: false });
    expect(await addAdmin("+96890000001")).toEqual({ ok: false, error: "USER_NOT_VERIFIED" });
  });

  it("returns USER_INACTIVE for a SUSPENDED/DEACTIVATED user — never silently reactivates", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    userFindUniqueMock.mockResolvedValue({ ...VERIFIED_USER, status: "DEACTIVATED" });
    expect(await addAdmin("+96890000001")).toEqual({ ok: false, error: "USER_INACTIVE" });
    expect(adminCreateMock).not.toHaveBeenCalled();
  });

  it("promotes a new admin (granted) and writes an admin.granted audit event in the same transaction", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    userFindUniqueMock.mockResolvedValue({ ...VERIFIED_USER });
    adminCreateMock.mockResolvedValue({ id: "admin-new" });

    const result = await addAdmin("+96890000001");

    expect(result).toEqual({ ok: true, outcome: "granted" });
    expect(adminCreateMock).toHaveBeenCalledWith({ data: { userId: "user-1", status: "ACTIVE" } });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorType: "ADMIN", actorId: "admin-1", action: "admin.granted", entityType: "Admin" }),
    });
  });

  it("reactivates a DEACTIVATED admin in place (no duplicate row)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    userFindUniqueMock.mockResolvedValue({ ...VERIFIED_USER, admin: { id: "admin-x", status: "DEACTIVATED" } });
    adminUpdateMock.mockResolvedValue({});

    const result = await addAdmin("+96890000001");

    expect(result).toEqual({ ok: true, outcome: "reactivated" });
    expect(adminUpdateMock).toHaveBeenCalledWith({ where: { id: "admin-x" }, data: { status: "ACTIVE" } });
    expect(adminCreateMock).not.toHaveBeenCalled();
    expect(auditCreateMock).toHaveBeenCalled();
  });

  it("returns already_active for an existing ACTIVE admin (idempotent, no mutation)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    userFindUniqueMock.mockResolvedValue({ ...VERIFIED_USER, admin: { id: "admin-x", status: "ACTIVE" } });

    const result = await addAdmin("+96890000001");

    expect(result).toEqual({ ok: true, outcome: "already_active" });
    expect(adminCreateMock).not.toHaveBeenCalled();
    expect(adminUpdateMock).not.toHaveBeenCalled();
  });
});
