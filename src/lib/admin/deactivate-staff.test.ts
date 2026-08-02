import { describe, it, expect, vi, afterEach } from "vitest";
import { ForbiddenError } from "@/lib/auth";

// User & Access Management (Batch 4) — regression tests for deactivateStaff().
// The tx mock exposes only staff.update + auditLog.create, so a passing test
// also demonstrates no unrelated (admin/customer/provider) profile is touched.

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

const { deactivateStaff } = await import("./deactivate-staff");
const ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  findUniqueMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("deactivateStaff", () => {
  it("denies a non-admin caller", async () => {
    requireAdminMock.mockRejectedValue(new ForbiddenError());
    expect(await deactivateStaff(ID)).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
  });

  it("returns INVALID_INPUT / STAFF_NOT_FOUND", async () => {
    expect(await deactivateStaff("nope")).toEqual({ ok: false, error: "INVALID_INPUT" });
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);
    expect(await deactivateStaff(ID)).toEqual({ ok: false, error: "STAFF_NOT_FOUND" });
  });

  it("is idempotent for an already-DEACTIVATED staff", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: ID, status: "DEACTIVATED", roles: ["SUPPORT"] });
    expect(await deactivateStaff(ID)).toEqual({ ok: true, outcome: "already_deactivated" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("deactivates an ACTIVE staff and writes staff.deactivated audit (only the staff row is mutated)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: ID, status: "ACTIVE", roles: ["SUPPORT"] });
    updateMock.mockResolvedValue({});

    const result = await deactivateStaff(ID);

    expect(result).toEqual({ ok: true, outcome: "deactivated" });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: ID }, data: { status: "DEACTIVATED" } });
    expect(auditCreateMock).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "staff.deactivated", actorId: "admin-1", entityId: ID }) });
  });
});
