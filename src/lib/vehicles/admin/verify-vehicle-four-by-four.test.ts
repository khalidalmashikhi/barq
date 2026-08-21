import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/uuid", () => ({ isValidUuid: (v: unknown) => typeof v === "string" && v.startsWith("asset-") }));

const requireAdminMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireAdmin: (...a: unknown[]) => requireAdminMock(...a),
  ForbiddenError: class ForbiddenError extends Error {},
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
const recordAuditEventMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: (...a: unknown[]) => recordAuditEventMock(...a) }));

const assetFindFirstMock = vi.fn();
const txUpdateMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    asset: { findFirst: (...a: unknown[]) => assetFindFirstMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) => cb({ vehicle: { update: (...a: unknown[]) => txUpdateMock(...a) } }),
  },
}));

const { verifyVehicleFourByFour } = await import("./verify-vehicle-four-by-four");

afterEach(() => vi.clearAllMocks());

describe("verifyVehicleFourByFour — admin-only trusted capability writer", () => {
  it("sets fourByFourVerified=true and audits ONLY the capability flag (no status/verification write)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    assetFindFirstMock.mockResolvedValue({ vehicle: { fourByFourVerified: null } });
    expect(await verifyVehicleFourByFour("asset-1", true)).toEqual({ ok: true });
    const call = txUpdateMock.mock.calls[0]![0];
    expect(call.where).toEqual({ assetId: "asset-1" });
    expect(call.data).toEqual({ fourByFourVerified: true }); // ONLY this field
    expect(call.data).not.toHaveProperty("status");
    expect(call.data).not.toHaveProperty("verificationStatus");
    expect(call.data).not.toHaveProperty("claimedFourByFour");
    const audit = recordAuditEventMock.mock.calls[0]![0];
    expect(audit).toMatchObject({ actorType: "ADMIN", actorId: "admin-1", action: "vehicle.four_by_four_verified", entityType: "Vehicle", entityId: "asset-1", previousValue: { fourByFourVerified: null }, newValue: { fourByFourVerified: true } });
  });

  it("can explicitly mark NOT 4x4 (false)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    assetFindFirstMock.mockResolvedValue({ vehicle: { fourByFourVerified: true } });
    expect(await verifyVehicleFourByFour("asset-1", false)).toEqual({ ok: true });
    expect(txUpdateMock.mock.calls[0]![0].data).toEqual({ fourByFourVerified: false });
    expect(recordAuditEventMock.mock.calls[0]![0].newValue).toEqual({ fourByFourVerified: false });
  });

  it("VEHICLE_NOT_FOUND for a missing vehicle; NO_ADMIN_PROFILE for a non-admin; INVALID_INPUT for bad input", async () => {
    expect(await verifyVehicleFourByFour("bad", true)).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();

    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    assetFindFirstMock.mockResolvedValue(null);
    expect(await verifyVehicleFourByFour("asset-1", true)).toEqual({ ok: false, error: "VEHICLE_NOT_FOUND" });

    const { ForbiddenError } = await import("@/lib/auth");
    requireAdminMock.mockRejectedValue(new (ForbiddenError as new () => Error)());
    expect(await verifyVehicleFourByFour("asset-1", true)).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
  });
});
