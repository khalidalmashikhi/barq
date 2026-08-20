import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/uuid", () => ({ isValidUuid: (v: unknown) => typeof v === "string" && v.startsWith("asset-") }));

const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a),
  ForbiddenError: class ForbiddenError extends Error {
    code?: string;
    constructor(m?: string, c?: string) {
      super(m);
      this.code = c;
    }
  },
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
const recordAuditEventMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: (...a: unknown[]) => recordAuditEventMock(...a) }));

const assetFindFirstMock = vi.fn();
const txAssetUpdateManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    asset: { findFirst: (...a: unknown[]) => assetFindFirstMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) => cb({ asset: { updateMany: (...a: unknown[]) => txAssetUpdateManyMock(...a) } }),
  },
}));

const { submitVehicleVerification } = await import("./submit-vehicle-verification");

const READY_DOCS = [
  { type: "VEHICLE_REGISTRATION", status: "PENDING" },
  { type: "VEHICLE_INSURANCE", status: "PENDING" },
];

afterEach(() => vi.clearAllMocks());

describe("submitVehicleVerification", () => {
  it("transitions DRAFT → SUBMITTED when required docs are present, and audits", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    assetFindFirstMock.mockResolvedValue({ id: "asset-1", verificationStatus: "DRAFT", documents: READY_DOCS });
    txAssetUpdateManyMock.mockResolvedValue({ count: 1 });
    const result = await submitVehicleVerification("asset-1");
    expect(result).toEqual({ ok: true, status: "SUBMITTED", alreadySubmitted: false });
    const call = txAssetUpdateManyMock.mock.calls[0]![0];
    // Guarded on editable states; sets SUBMITTED + timestamp; clears review metadata + reason.
    expect(call.where).toEqual({ id: "asset-1", verificationStatus: { in: ["DRAFT", "CHANGES_REQUESTED"] } });
    expect(call.data.verificationStatus).toBe("SUBMITTED");
    expect(call.data.verificationSubmittedAt).toBeInstanceOf(Date);
    expect(call.data.verificationReviewedAt).toBeNull();
    expect(call.data.verificationReviewedByAdminId).toBeNull();
    expect(call.data.verificationReason).toBeNull();
    // NEVER approves or activates.
    expect(call.data.verificationStatus).not.toBe("APPROVED");
    expect(call.data).not.toHaveProperty("status");
    expect(recordAuditEventMock.mock.calls[0]![0]).toMatchObject({ action: "vehicle.verification_submitted", entityType: "Vehicle", entityId: "asset-1" });
  });

  it("also transitions from CHANGES_REQUESTED", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    assetFindFirstMock.mockResolvedValue({ id: "asset-1", verificationStatus: "CHANGES_REQUESTED", documents: READY_DOCS });
    txAssetUpdateManyMock.mockResolvedValue({ count: 1 });
    expect((await submitVehicleVerification("asset-1")).ok).toBe(true);
  });

  it("is an idempotent no-op when already SUBMITTED (no write, no audit)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    assetFindFirstMock.mockResolvedValue({ id: "asset-1", verificationStatus: "SUBMITTED", documents: READY_DOCS });
    expect(await submitVehicleVerification("asset-1")).toEqual({ ok: true, status: "SUBMITTED", alreadySubmitted: true });
    expect(txAssetUpdateManyMock).not.toHaveBeenCalled();
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it("returns NOT_READY with blockers when a required doc is missing", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    assetFindFirstMock.mockResolvedValue({ id: "asset-1", verificationStatus: "DRAFT", documents: [{ type: "VEHICLE_REGISTRATION", status: "PENDING" }] });
    const result = await submitVehicleVerification("asset-1");
    expect(result).toMatchObject({ ok: false, error: "NOT_READY" });
    if (!result.ok && result.error === "NOT_READY") expect(result.blockers).toEqual([{ type: "VEHICLE_INSURANCE", reason: "MISSING" }]);
    expect(txAssetUpdateManyMock).not.toHaveBeenCalled();
  });

  it("returns NOT_READY when a required doc is REJECTED (must replace first)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    assetFindFirstMock.mockResolvedValue({ id: "asset-1", verificationStatus: "CHANGES_REQUESTED", documents: [
      { type: "VEHICLE_REGISTRATION", status: "PENDING" },
      { type: "VEHICLE_INSURANCE", status: "REJECTED" },
    ] });
    const result = await submitVehicleVerification("asset-1");
    expect(result).toMatchObject({ ok: false, error: "NOT_READY" });
  });

  it("returns INVALID_STATE from a terminal/non-editable status (e.g. APPROVED)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    assetFindFirstMock.mockResolvedValue({ id: "asset-1", verificationStatus: "APPROVED", documents: READY_DOCS });
    expect(await submitVehicleVerification("asset-1")).toEqual({ ok: false, error: "INVALID_STATE" });
  });

  it("returns VEHICLE_NOT_FOUND for a foreign/missing vehicle", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    assetFindFirstMock.mockResolvedValue(null);
    expect(await submitVehicleVerification("asset-x")).toEqual({ ok: false, error: "VEHICLE_NOT_FOUND" });
  });

  it("treats a lost submit race (updateMany count 0) as idempotent success, no audit", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    assetFindFirstMock.mockResolvedValue({ id: "asset-1", verificationStatus: "DRAFT", documents: READY_DOCS });
    txAssetUpdateManyMock.mockResolvedValue({ count: 0 });
    expect(await submitVehicleVerification("asset-1")).toEqual({ ok: true, status: "SUBMITTED", alreadySubmitted: true });
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid vehicle id as VEHICLE_NOT_FOUND before auth", async () => {
    expect(await submitVehicleVerification("bad")).toEqual({ ok: false, error: "VEHICLE_NOT_FOUND" });
    expect(requireApprovedProviderMock).not.toHaveBeenCalled();
  });

  it("maps a not-approved provider to PROVIDER_NOT_APPROVED", async () => {
    const { ForbiddenError } = await import("@/lib/auth");
    requireApprovedProviderMock.mockRejectedValue(new (ForbiddenError as new (m?: string, c?: string) => Error)("nope", "PROVIDER_NOT_APPROVED"));
    expect(await submitVehicleVerification("asset-1")).toEqual({ ok: false, error: "PROVIDER_NOT_APPROVED" });
  });
});
