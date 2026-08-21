import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/uuid", () => ({ isValidUuid: (v: unknown) => typeof v === "string" && (v.startsWith("svc-") || v.startsWith("veh-")) }));

const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a),
  ForbiddenError: class ForbiddenError extends Error { code?: string },
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
const recordAuditEventMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: (...a: unknown[]) => recordAuditEventMock(...a) }));

const serviceFindFirstMock = vi.fn();
const poolDeleteManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    service: { findFirst: (...a: unknown[]) => serviceFindFirstMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({ tourServiceVehicle: { deleteMany: (...a: unknown[]) => poolDeleteManyMock(...a) } }),
  },
}));

const { removeVehicleFromTourServicePool } = await import("./remove-vehicle-from-tour-service-pool");

afterEach(() => vi.clearAllMocks());

describe("removeVehicleFromTourServicePool", () => {
  it("INVALID_INPUT for malformed ids", async () => {
    expect(await removeVehicleFromTourServicePool("bad", "veh-1")).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("removes a pooled vehicle and audits (delete scoped to the owning provider)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    serviceFindFirstMock.mockResolvedValue({ id: "svc-1" });
    poolDeleteManyMock.mockResolvedValue({ count: 1 });

    expect(await removeVehicleFromTourServicePool("svc-1", "veh-1")).toEqual({ ok: true });
    expect(poolDeleteManyMock.mock.calls[0]![0]).toEqual({ where: { serviceId: "svc-1", vehicleId: "veh-1", service: { providerId: "prov-1" } } });
    expect(recordAuditEventMock.mock.calls[0]![0]).toMatchObject({ actorType: "PROVIDER", action: "tour.vehicle_pool_removed", entityType: "Service", entityId: "svc-1", previousValue: { vehicleId: "veh-1" } });
  });

  it("removing an absent row is idempotent success with NO audit event", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    serviceFindFirstMock.mockResolvedValue({ id: "svc-1" });
    poolDeleteManyMock.mockResolvedValue({ count: 0 });

    expect(await removeVehicleFromTourServicePool("svc-1", "veh-1")).toEqual({ ok: true });
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it("foreign/missing service => uniform SERVICE_NOT_FOUND (nothing deleted)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    serviceFindFirstMock.mockResolvedValue(null);
    expect(await removeVehicleFromTourServicePool("svc-1", "veh-1")).toEqual({ ok: false, error: "SERVICE_NOT_FOUND" });
    expect(poolDeleteManyMock).not.toHaveBeenCalled();
  });

  it("maps NOT-approved provider to PROVIDER_NOT_APPROVED", async () => {
    const { ForbiddenError } = await import("@/lib/auth");
    const notApproved = new (ForbiddenError as new () => Error & { code?: string })();
    (notApproved as { code?: string }).code = "PROVIDER_NOT_APPROVED";
    requireApprovedProviderMock.mockRejectedValue(notApproved);
    expect(await removeVehicleFromTourServicePool("svc-1", "veh-1")).toEqual({ ok: false, error: "PROVIDER_NOT_APPROVED" });
  });
});
