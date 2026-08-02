import { describe, it, expect, vi, afterEach } from "vitest";
import { ForbiddenError } from "@/lib/auth";

// User & Access Management (Batch 3) — regression tests for deactivateAdmin(),
// including the atomic last-ACTIVE-admin protection. The transaction mock
// provides $queryRaw (the FOR UPDATE lock/count), admin.findUnique/update and
// auditLog.create, so the count-then-mutate logic is exercised end to end.

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const queryRawMock = vi.fn();
const findUniqueMock = vi.fn();
const updateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        $queryRaw: (...args: unknown[]) => queryRawMock(...args),
        admin: {
          findUnique: (...args: unknown[]) => findUniqueMock(...args),
          update: (...args: unknown[]) => updateMock(...args),
        },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { deactivateAdmin } = await import("./deactivate-admin");

const ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
const OTHER = "019f4e4e-8116-7052-b15e-b79b5ccb1b00";

afterEach(() => {
  requireAdminMock.mockReset();
  queryRawMock.mockReset();
  findUniqueMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("deactivateAdmin", () => {
  it("denies a non-admin / inactive-admin caller", async () => {
    requireAdminMock.mockRejectedValue(new ForbiddenError());
    expect(await deactivateAdmin(ID)).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
  });

  it("returns INVALID_INPUT for a non-UUID id", async () => {
    expect(await deactivateAdmin("nope")).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("returns ADMIN_NOT_FOUND when the admin doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    queryRawMock.mockResolvedValue([{ id: OTHER }]);
    findUniqueMock.mockResolvedValue(null);
    expect(await deactivateAdmin(ID)).toEqual({ ok: false, error: "ADMIN_NOT_FOUND" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("is idempotent for an already-DEACTIVATED admin", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    queryRawMock.mockResolvedValue([{ id: OTHER }]);
    findUniqueMock.mockResolvedValue({ id: ID, status: "DEACTIVATED" });
    expect(await deactivateAdmin(ID)).toEqual({ ok: true, outcome: "already_deactivated" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("refuses to deactivate the LAST ACTIVE admin (also covers self-deactivation as the final admin)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: ID } }); // caller IS the target
    queryRawMock.mockResolvedValue([{ id: ID }]); // exactly one ACTIVE admin
    findUniqueMock.mockResolvedValue({ id: ID, status: "ACTIVE" });

    const result = await deactivateAdmin(ID);

    expect(result).toEqual({ ok: false, error: "LAST_ACTIVE_ADMIN" });
    expect(updateMock).not.toHaveBeenCalled();
    expect(auditCreateMock).not.toHaveBeenCalled();
  });

  it("deactivates when another ACTIVE admin remains, writing an admin.deactivated audit event atomically", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: OTHER } });
    queryRawMock.mockResolvedValue([{ id: ID }, { id: OTHER }]); // two ACTIVE admins
    findUniqueMock.mockResolvedValue({ id: ID, status: "ACTIVE" });
    updateMock.mockResolvedValue({});

    const result = await deactivateAdmin(ID);

    expect(result).toEqual({ ok: true, outcome: "deactivated" });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: ID }, data: { status: "DEACTIVATED" } });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "admin.deactivated",
        actorId: OTHER,
        entityId: ID,
        previousValue: { status: "ACTIVE" },
        newValue: { status: "DEACTIVATED" },
      }),
    });
  });
});
