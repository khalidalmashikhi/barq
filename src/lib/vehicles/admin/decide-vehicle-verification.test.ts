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
const txUpdateManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    asset: { findFirst: (...a: unknown[]) => assetFindFirstMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) => cb({ asset: { updateMany: (...a: unknown[]) => txUpdateManyMock(...a) } }),
  },
}));

const { approveVehicleVerification, rejectVehicleVerification, requestVehicleChanges } = await import("./decide-vehicle-verification");

const READY_DOCS = [
  { type: "VEHICLE_REGISTRATION", status: "APPROVED", expiresAt: null },
  { type: "VEHICLE_INSURANCE", status: "APPROVED", expiresAt: null },
];

afterEach(() => vi.clearAllMocks());

describe("approveVehicleVerification — two-axis guarantee", () => {
  it("SUBMITTED → APPROVED when ready; sets review metadata; NEVER writes Asset.status", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    assetFindFirstMock.mockResolvedValue({ verificationStatus: "SUBMITTED", vehicle: { assetId: "asset-1" }, documents: READY_DOCS });
    txUpdateManyMock.mockResolvedValue({ count: 1 });
    const result = await approveVehicleVerification("asset-1");
    expect(result).toEqual({ ok: true });
    const call = txUpdateManyMock.mock.calls[0]![0];
    expect(call.where).toEqual({ id: "asset-1", verificationStatus: "SUBMITTED" });
    expect(call.data).toMatchObject({ verificationStatus: "APPROVED", verificationReviewedByAdminId: "admin-1", verificationReason: null });
    // CRITICAL: verification approval is NOT operational activation.
    expect(call.data).not.toHaveProperty("status");
    expect(call.data.verificationStatus).not.toBe("ACTIVE");
    expect(recordAuditEventMock.mock.calls[0]![0]).toMatchObject({ actorType: "ADMIN", action: "vehicle.verification_approved", entityType: "Vehicle", entityId: "asset-1" });
  });

  it("returns NOT_READY when a required document is not approved (no write)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    assetFindFirstMock.mockResolvedValue({ verificationStatus: "SUBMITTED", vehicle: { assetId: "asset-1" }, documents: [{ type: "VEHICLE_REGISTRATION", status: "PENDING", expiresAt: null }, READY_DOCS[1]] });
    expect(await approveVehicleVerification("asset-1")).toEqual({ ok: false, error: "NOT_READY" });
    expect(txUpdateManyMock).not.toHaveBeenCalled();
  });

  it("returns NOT_SUBMITTED when the vehicle is not SUBMITTED", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    assetFindFirstMock.mockResolvedValue({ verificationStatus: "DRAFT", vehicle: { assetId: "asset-1" }, documents: READY_DOCS });
    expect(await approveVehicleVerification("asset-1")).toEqual({ ok: false, error: "NOT_SUBMITTED" });
  });

  it("treats a lost race (updateMany count 0) as NOT_SUBMITTED, no audit", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    assetFindFirstMock.mockResolvedValue({ verificationStatus: "SUBMITTED", vehicle: { assetId: "asset-1" }, documents: READY_DOCS });
    txUpdateManyMock.mockResolvedValue({ count: 0 });
    expect(await approveVehicleVerification("asset-1")).toEqual({ ok: false, error: "NOT_SUBMITTED" });
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it("VEHICLE_NOT_FOUND for a missing vehicle; NO_ADMIN_PROFILE for a non-admin", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    assetFindFirstMock.mockResolvedValue(null);
    expect(await approveVehicleVerification("asset-1")).toEqual({ ok: false, error: "VEHICLE_NOT_FOUND" });
    const { ForbiddenError } = await import("@/lib/auth");
    requireAdminMock.mockRejectedValue(new (ForbiddenError as new () => Error)());
    expect(await approveVehicleVerification("asset-1")).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
  });
});

describe("rejectVehicleVerification / requestVehicleChanges", () => {
  it("SUBMITTED → REJECTED with a reason; never writes Asset.status", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    assetFindFirstMock.mockResolvedValue({ verificationStatus: "SUBMITTED" });
    txUpdateManyMock.mockResolvedValue({ count: 1 });
    expect(await rejectVehicleVerification("asset-1", "Not eligible")).toEqual({ ok: true });
    const call = txUpdateManyMock.mock.calls[0]![0];
    expect(call.data).toMatchObject({ verificationStatus: "REJECTED", verificationReason: "Not eligible", verificationReviewedByAdminId: "admin-1" });
    expect(call.data).not.toHaveProperty("status");
    expect(recordAuditEventMock.mock.calls[0]![0]).toMatchObject({ action: "vehicle.verification_rejected", entityType: "Vehicle" });
  });

  it("SUBMITTED → CHANGES_REQUESTED with a reason; never writes Asset.status", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    assetFindFirstMock.mockResolvedValue({ verificationStatus: "SUBMITTED" });
    txUpdateManyMock.mockResolvedValue({ count: 1 });
    expect(await requestVehicleChanges("asset-1", "Please re-upload")).toEqual({ ok: true });
    const call = txUpdateManyMock.mock.calls[0]![0];
    expect(call.data).toMatchObject({ verificationStatus: "CHANGES_REQUESTED", verificationReason: "Please re-upload" });
    expect(call.data).not.toHaveProperty("status");
    expect(recordAuditEventMock.mock.calls[0]![0]).toMatchObject({ action: "vehicle.changes_requested" });
  });

  it("requires a reason for both reject and request-changes", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    expect(await rejectVehicleVerification("asset-1", "  ")).toEqual({ ok: false, error: "REASON_REQUIRED" });
    expect(await requestVehicleChanges("asset-1", "")).toEqual({ ok: false, error: "REASON_REQUIRED" });
  });

  it("returns NOT_SUBMITTED when the vehicle is not SUBMITTED", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    assetFindFirstMock.mockResolvedValue({ verificationStatus: "APPROVED" });
    expect(await rejectVehicleVerification("asset-1", "x")).toEqual({ ok: false, error: "NOT_SUBMITTED" });
  });

  it("rejects an invalid vehicle id as INVALID_INPUT before auth", async () => {
    expect(await rejectVehicleVerification("bad", "x")).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });
});
