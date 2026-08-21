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
const notifyMock = vi.fn();
vi.mock("@/lib/notifications/vehicle-notification-events", () => ({
  notifyProviderOfVehicleEvent: (...a: unknown[]) => notifyMock(...a),
  VEHICLE_NOTIFICATION_EVENT: { ACTIVATED: "vehicle.activated" },
}));

const assetFindFirstMock = vi.fn();
const txUpdateManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    asset: { findFirst: (...a: unknown[]) => assetFindFirstMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) => cb({ asset: { updateMany: (...a: unknown[]) => txUpdateManyMock(...a) } }),
  },
}));

const { activateVehicle } = await import("./activate-vehicle");

const READY_DOCS = [
  { type: "VEHICLE_REGISTRATION", status: "APPROVED", expiresAt: null },
  { type: "VEHICLE_INSURANCE", status: "APPROVED", expiresAt: null },
];
const readyAsset = (over: Record<string, unknown> = {}) => ({
  status: "REGISTERED",
  verificationStatus: "APPROVED",
  vehicle: { assetId: "asset-1" },
  documents: READY_DOCS,
  provider: { userId: "user-1" },
  ...over,
});

afterEach(() => vi.clearAllMocks());

describe("activateVehicle — two-axis operational activation", () => {
  it("REGISTERED + APPROVED + ready → ACTIVE; writes ONLY status; audits; notifies provider", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    assetFindFirstMock.mockResolvedValue(readyAsset());
    txUpdateManyMock.mockResolvedValue({ count: 1 });
    expect(await activateVehicle("asset-1")).toEqual({ ok: true });
    const call = txUpdateManyMock.mock.calls[0]![0];
    // Guarded on the exact source state.
    expect(call.where).toEqual({ id: "asset-1", status: "REGISTERED", verificationStatus: "APPROVED" });
    // ONLY the operational axis is written.
    expect(call.data).toEqual({ status: "ACTIVE" });
    expect(call.data).not.toHaveProperty("verificationStatus");
    const audit = recordAuditEventMock.mock.calls[0]![0];
    expect(audit).toMatchObject({ actorType: "ADMIN", actorId: "admin-1", action: "vehicle.activated", entityType: "Vehicle", entityId: "asset-1", previousValue: { status: "REGISTERED" }, newValue: { status: "ACTIVE" } });
    expect(notifyMock).toHaveBeenCalledWith("vehicle.activated", { providerUserId: "user-1", assetId: "asset-1" });
  });

  it("ALREADY_ACTIVE when the vehicle is already ACTIVE (no write, no audit, no notify)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    assetFindFirstMock.mockResolvedValue(readyAsset({ status: "ACTIVE" }));
    expect(await activateVehicle("asset-1")).toEqual({ ok: false, error: "ALREADY_ACTIVE" });
    expect(txUpdateManyMock).not.toHaveBeenCalled();
    expect(recordAuditEventMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("NOT_READY when verification is not APPROVED (no write)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    assetFindFirstMock.mockResolvedValue(readyAsset({ verificationStatus: "SUBMITTED" }));
    expect(await activateVehicle("asset-1")).toEqual({ ok: false, error: "NOT_READY" });
    expect(txUpdateManyMock).not.toHaveBeenCalled();
  });

  it("NOT_READY when a required document is missing / pending / rejected / expired", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    for (const docs of [
      [READY_DOCS[0]!], // insurance missing
      [{ type: "VEHICLE_REGISTRATION", status: "PENDING", expiresAt: null }, READY_DOCS[1]!],
      [{ type: "VEHICLE_REGISTRATION", status: "REJECTED", expiresAt: null }, READY_DOCS[1]!],
      [READY_DOCS[0]!, { type: "VEHICLE_INSURANCE", status: "APPROVED", expiresAt: new Date("2000-01-01T00:00:00Z") }],
    ]) {
      assetFindFirstMock.mockResolvedValue(readyAsset({ documents: docs }));
      expect(await activateVehicle("asset-1")).toEqual({ ok: false, error: "NOT_READY" });
    }
    expect(txUpdateManyMock).not.toHaveBeenCalled();
  });

  it("ACTIVATION_CONFLICT when the guarded write loses the race (count 0) — no audit, no notify", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    assetFindFirstMock.mockResolvedValue(readyAsset());
    txUpdateManyMock.mockResolvedValue({ count: 0 });
    expect(await activateVehicle("asset-1")).toEqual({ ok: false, error: "ACTIVATION_CONFLICT" });
    expect(recordAuditEventMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("VEHICLE_NOT_FOUND for a missing vehicle; NO_ADMIN_PROFILE for a non-admin; INVALID_INPUT for a bad id", async () => {
    expect(await activateVehicle("bad")).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();

    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    assetFindFirstMock.mockResolvedValue(null);
    expect(await activateVehicle("asset-1")).toEqual({ ok: false, error: "VEHICLE_NOT_FOUND" });

    const { ForbiddenError } = await import("@/lib/auth");
    requireAdminMock.mockRejectedValue(new (ForbiddenError as new () => Error)());
    expect(await activateVehicle("asset-1")).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
  });
});
