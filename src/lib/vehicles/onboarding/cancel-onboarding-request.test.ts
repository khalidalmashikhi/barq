import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// Unit suite for cancel-by-key: which branch each request state takes and what is (not) audited or
// logged. The races it is designed for are proven on PostgreSQL in onboarding-request.dbproof.test.ts.

vi.mock("server-only", () => ({}));
const requireApprovedProviderMock = vi.fn();
class ForbiddenError extends Error {}
class UnauthenticatedError extends Error {}
vi.mock("@/lib/auth", () => ({ requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a), ForbiddenError, UnauthenticatedError }));
const auditMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: (...a: unknown[]) => auditMock(...a) }));
const loggerError = vi.fn();
vi.mock("@/lib/logger", () => ({ logger: { error: (...a: unknown[]) => loggerError(...a), info: vi.fn(), warn: vi.fn() } }));
const deleteDraftMock = vi.fn();
vi.mock("./delete-draft-vehicle", () => ({ deleteDraftVehicle: (...a: unknown[]) => deleteDraftMock(...a) }));

const findUnique = vi.fn();
const txCreate = vi.fn();
const txUpdateMany = vi.fn();
const tx = { vehicleOnboardingRequest: { create: (...a: unknown[]) => txCreate(...a), updateMany: (...a: unknown[]) => txUpdateMany(...a) } };
vi.mock("@/lib/db", () => ({
  prisma: {
    vehicleOnboardingRequest: { findUnique: (...a: unknown[]) => findUnique(...a) },
    $transaction: async (cb: (t: unknown) => unknown) => cb(tx),
  },
}));

const { cancelVehicleOnboardingRequest } = await import("./cancel-onboarding-request");

const KEY = "request-key-0001";
const p2002 = () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "5.22.0" });

beforeEach(() => {
  vi.clearAllMocks();
  requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1", status: "APPROVED" } });
  txCreate.mockResolvedValue({ id: "req-new" });
  txUpdateMany.mockResolvedValue({ count: 1 });
  auditMock.mockResolvedValue(undefined);
});

describe("cancelVehicleOnboardingRequest", () => {
  it.each([undefined, null, "", "short", "bad key", 42])("a malformed key (%j) is refused before authentication", async (bad) => {
    expect(await cancelVehicleOnboardingRequest(bad)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(requireApprovedProviderMock).not.toHaveBeenCalled();
  });

  it("a provider that is not approved cannot cancel; unauthenticated propagates", async () => {
    requireApprovedProviderMock.mockRejectedValueOnce(new ForbiddenError());
    expect(await cancelVehicleOnboardingRequest(KEY)).toEqual({ ok: false, code: "PROVIDER_NOT_APPROVED" });
    requireApprovedProviderMock.mockRejectedValueOnce(new UnauthenticatedError());
    await expect(cancelVehicleOnboardingRequest(KEY)).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("the key is looked up ONLY under the authenticated provider", async () => {
    findUnique.mockResolvedValue({ id: "req-1", status: "CANCELLED", assetId: null });
    await cancelVehicleOnboardingRequest(KEY);
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { providerId_idempotencyKey: { providerId: "prov-1", idempotencyKey: KEY } } }));
  });

  it("no request yet → writes a CANCELLED tombstone (so the delayed upload can create nothing) and audits it", async () => {
    findUnique.mockResolvedValue(null);
    expect(await cancelVehicleOnboardingRequest(KEY)).toEqual({ ok: true });
    expect(txCreate.mock.calls[0]![0].data).toMatchObject({ providerId: "prov-1", idempotencyKey: KEY, status: "CANCELLED", leaseToken: null });
    expect(auditMock.mock.calls[0]![0]).toMatchObject({ action: "vehicle.onboarding_request_cancelled", entityType: "VehicleOnboardingRequest", entityId: "req-new", previousValue: { status: "NONE" } });
    expect(auditMock.mock.calls[0]![1]).toBe(tx); // in the same transaction
  });

  it("the delayed upload arrived between the read and the tombstone (unique violation) → re-reads and cancels what exists", async () => {
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "req-1", status: "PENDING", assetId: null });
    txCreate.mockRejectedValueOnce(p2002());
    expect(await cancelVehicleOnboardingRequest(KEY)).toEqual({ ok: true });
    expect(txUpdateMany.mock.calls[0]![0].where).toEqual({ id: "req-1", status: "PENDING", assetId: null });
  });

  it("PENDING → guarded transition to CANCELLED (the in-flight attempt can then commit nothing)", async () => {
    findUnique.mockResolvedValue({ id: "req-1", status: "PENDING", assetId: null });
    expect(await cancelVehicleOnboardingRequest(KEY)).toEqual({ ok: true });
    const arg = txUpdateMany.mock.calls[0]![0] as { where: unknown; data: Record<string, unknown> };
    expect(arg.where).toEqual({ id: "req-1", status: "PENDING", assetId: null });
    expect(arg.data).toMatchObject({ status: "CANCELLED", leaseToken: null, leaseExpiresAt: null });
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(deleteDraftMock).not.toHaveBeenCalled();
  });

  it("PENDING but the attempt completed first → the next pass cancels the ONE setup it created", async () => {
    findUnique.mockResolvedValueOnce({ id: "req-1", status: "PENDING", assetId: null }).mockResolvedValueOnce({ id: "req-1", status: "COMPLETED", assetId: "veh-1" });
    txUpdateMany.mockResolvedValueOnce({ count: 0 });
    deleteDraftMock.mockResolvedValue({ ok: true });
    expect(await cancelVehicleOnboardingRequest(KEY)).toEqual({ ok: true });
    expect(deleteDraftMock).toHaveBeenCalledWith("veh-1");
    expect(auditMock).not.toHaveBeenCalled(); // the setup cancellation writes its own audit
  });

  it("COMPLETED → cancels through deleteDraftVehicle (owner-scoped, blank-shell-only, tombstones the request)", async () => {
    findUnique.mockResolvedValue({ id: "req-1", status: "COMPLETED", assetId: "veh-1" });
    deleteDraftMock.mockResolvedValue({ ok: true });
    expect(await cancelVehicleOnboardingRequest(KEY)).toEqual({ ok: true });
    expect(deleteDraftMock).toHaveBeenCalledWith("veh-1");
    expect(txUpdateMany).not.toHaveBeenCalled();
  });

  it("COMPLETED but the vehicle has since been confirmed → NOT_CANCELLABLE; the request is left as it is", async () => {
    findUnique.mockResolvedValue({ id: "req-1", status: "COMPLETED", assetId: "veh-1" });
    deleteDraftMock.mockResolvedValue({ ok: false, code: "NOT_DELETABLE" });
    expect(await cancelVehicleOnboardingRequest(KEY)).toEqual({ ok: false, code: "NOT_CANCELLABLE" });
    expect(txUpdateMany).not.toHaveBeenCalled();
  });

  it("CANCELLED → idempotent success; nothing written", async () => {
    findUnique.mockResolvedValue({ id: "req-1", status: "CANCELLED", assetId: null });
    expect(await cancelVehicleOnboardingRequest(KEY)).toEqual({ ok: true });
    expect(txCreate).not.toHaveBeenCalled();
    expect(txUpdateMany).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("gives up safely (bounded) if the request keeps changing under it", async () => {
    findUnique.mockResolvedValue({ id: "req-1", status: "PENDING", assetId: null });
    txUpdateMany.mockResolvedValue({ count: 0 });
    expect(await cancelVehicleOnboardingRequest(KEY)).toEqual({ ok: false, code: "UNKNOWN_ERROR" });
    expect(findUnique.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("a database failure is a safe code; neither the audit nor the log ever carries the key", async () => {
    findUnique.mockResolvedValue(null);
    expect(await cancelVehicleOnboardingRequest(KEY)).toEqual({ ok: true });
    expect(JSON.stringify(auditMock.mock.calls)).not.toContain(KEY);

    findUnique.mockRejectedValue(new Error(`boom for key ${KEY}`));
    expect(await cancelVehicleOnboardingRequest(KEY)).toEqual({ ok: false, code: "UNKNOWN_ERROR" });
    expect(loggerError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(loggerError.mock.calls)).not.toContain(KEY);
    expect(Object.keys(loggerError.mock.calls[0]![1] as object).sort()).toEqual(["error", "providerId"]);
  });
});
