import { describe, it, expect, vi, afterEach } from "vitest";
import { ForbiddenError } from "@/lib/auth";

// User & Access Management (Batch 3) — regression tests for activateAdmin().

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
    admin: { findUnique: (...args: unknown[]) => findUniqueMock(...args) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        admin: { update: (...args: unknown[]) => updateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { activateAdmin } = await import("./activate-admin");

const ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  findUniqueMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("activateAdmin", () => {
  it("denies a non-admin / inactive-admin caller", async () => {
    requireAdminMock.mockRejectedValue(new ForbiddenError());
    expect(await activateAdmin(ID)).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
  });

  it("returns INVALID_INPUT for a non-UUID id", async () => {
    expect(await activateAdmin("not-a-uuid")).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("returns ADMIN_NOT_FOUND when the admin doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);
    expect(await activateAdmin(ID)).toEqual({ ok: false, error: "ADMIN_NOT_FOUND" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("is idempotent for an already-ACTIVE admin (no mutation)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: ID, status: "ACTIVE" });
    expect(await activateAdmin(ID)).toEqual({ ok: true, outcome: "already_active" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("activates a DEACTIVATED admin and writes an admin.activated audit event", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: ID, status: "DEACTIVATED" });
    updateMock.mockResolvedValue({});

    const result = await activateAdmin(ID);

    expect(result).toEqual({ ok: true, outcome: "activated" });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: ID }, data: { status: "ACTIVE" } });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "admin.activated", actorId: "admin-1", entityId: ID }),
    });
  });
});
