import { describe, it, expect, vi, afterEach } from "vitest";
import { Prisma } from "@prisma/client";

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

const loadContextMock = vi.fn();
vi.mock("./tour-service-context", () => ({ loadOwnedTourServiceContext: (...a: unknown[]) => loadContextMock(...a) }));

const evaluateMock = vi.fn();
vi.mock("./pool-dto", () => ({ POOL_VEHICLE_SELECT: {}, evaluatePoolVehicle: (...a: unknown[]) => evaluateMock(...a) }));

const vehicleFindFirstMock = vi.fn();
const poolCreateMock = vi.fn();
const providerCategoryCreateMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    vehicle: { findFirst: (...a: unknown[]) => vehicleFindFirstMock(...a) },
    providerCategory: { create: (...a: unknown[]) => providerCategoryCreateMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        tourServiceVehicle: { create: (...a: unknown[]) => poolCreateMock(...a) },
        providerCategory: { create: (...a: unknown[]) => providerCategoryCreateMock(...a) },
      }),
  },
}));

const { addVehicleToTourServicePool } = await import("./add-vehicle-to-tour-service-pool");

const TRANSPORT_CTX = { ok: true, context: { serviceId: "svc-1", providerId: "prov-1", packageType: "GUIDE_WITH_TRANSPORT", maxGuests: null } };

function approvedProvider() {
  requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
}

afterEach(() => vi.clearAllMocks());

describe("addVehicleToTourServicePool", () => {
  it("INVALID_INPUT for malformed ids (auth never consulted)", async () => {
    expect(await addVehicleToTourServicePool("bad", "veh-1")).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireApprovedProviderMock).not.toHaveBeenCalled();
  });

  it("adds an eligible owned vehicle: creates the pool row and audits (no providerId from client, no ProviderCategory write)", async () => {
    approvedProvider();
    loadContextMock.mockResolvedValue(TRANSPORT_CTX);
    vehicleFindFirstMock.mockResolvedValue({ assetId: "veh-1", asset: { providerId: "prov-1" } });
    evaluateMock.mockReturnValue({ blockers: [] });

    expect(await addVehicleToTourServicePool("svc-1", "veh-1")).toEqual({ ok: true });

    // Vehicle lookup scoped to the AUTHENTICATED provider (ownership derived server-side).
    expect(vehicleFindFirstMock.mock.calls[0]![0].where).toMatchObject({ assetId: "veh-1", asset: { providerId: "prov-1", assetType: "VEHICLE" } });
    // Pool row created with exactly the pair — no providerId column exists to spoof.
    expect(poolCreateMock.mock.calls[0]![0]).toEqual({ data: { serviceId: "svc-1", vehicleId: "veh-1" } });
    const audit = recordAuditEventMock.mock.calls[0]![0];
    expect(audit).toMatchObject({ actorType: "PROVIDER", actorId: "prov-1", action: "tour.vehicle_pool_added", entityType: "Service", entityId: "svc-1", newValue: { vehicleId: "veh-1" } });
    // B4/B5 isolation — adding a vehicle never grants a category.
    expect(providerCategoryCreateMock).not.toHaveBeenCalled();
  });

  it("SERVICE_NOT_FOUND / TOUR_SERVICE_NOT_ELIGIBLE bubble up from the context loader", async () => {
    approvedProvider();
    loadContextMock.mockResolvedValueOnce({ ok: false, error: "SERVICE_NOT_FOUND" });
    expect(await addVehicleToTourServicePool("svc-1", "veh-1")).toEqual({ ok: false, error: "SERVICE_NOT_FOUND" });
    loadContextMock.mockResolvedValueOnce({ ok: false, error: "TOUR_SERVICE_NOT_ELIGIBLE" });
    expect(await addVehicleToTourServicePool("svc-1", "veh-1")).toEqual({ ok: false, error: "TOUR_SERVICE_NOT_ELIGIBLE" });
    expect(vehicleFindFirstMock).not.toHaveBeenCalled();
  });

  it("GUIDE_ONLY package cannot hold a pool => TOUR_SERVICE_NOT_ELIGIBLE (vehicle never fetched)", async () => {
    approvedProvider();
    loadContextMock.mockResolvedValue({ ok: true, context: { serviceId: "svc-1", providerId: "prov-1", packageType: "GUIDE_ONLY", maxGuests: null } });
    expect(await addVehicleToTourServicePool("svc-1", "veh-1")).toEqual({ ok: false, error: "TOUR_SERVICE_NOT_ELIGIBLE" });
    expect(vehicleFindFirstMock).not.toHaveBeenCalled();
  });

  it("foreign/missing vehicle => uniform VEHICLE_NOT_FOUND", async () => {
    approvedProvider();
    loadContextMock.mockResolvedValue(TRANSPORT_CTX);
    vehicleFindFirstMock.mockResolvedValue(null);
    expect(await addVehicleToTourServicePool("svc-1", "veh-1")).toEqual({ ok: false, error: "VEHICLE_NOT_FOUND" });
    expect(poolCreateMock).not.toHaveBeenCalled();
  });

  it("ineligible vehicle (blockers present) => VEHICLE_NOT_ELIGIBLE, no row written", async () => {
    approvedProvider();
    loadContextMock.mockResolvedValue(TRANSPORT_CTX);
    vehicleFindFirstMock.mockResolvedValue({ assetId: "veh-1", asset: { providerId: "prov-1" } });
    evaluateMock.mockReturnValue({ blockers: ["NOT_ACTIVE"] });
    expect(await addVehicleToTourServicePool("svc-1", "veh-1")).toEqual({ ok: false, error: "VEHICLE_NOT_ELIGIBLE" });
    expect(poolCreateMock).not.toHaveBeenCalled();
  });

  it("adding an already-pooled vehicle is idempotent success (unique violation swallowed, no error)", async () => {
    approvedProvider();
    loadContextMock.mockResolvedValue(TRANSPORT_CTX);
    vehicleFindFirstMock.mockResolvedValue({ assetId: "veh-1", asset: { providerId: "prov-1" } });
    evaluateMock.mockReturnValue({ blockers: [] });
    poolCreateMock.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    expect(await addVehicleToTourServicePool("svc-1", "veh-1")).toEqual({ ok: true });
  });

  it("maps provider auth failures; UnauthenticatedError is rethrown", async () => {
    const { ForbiddenError, UnauthenticatedError } = await import("@/lib/auth");
    const notApproved = new (ForbiddenError as new () => Error & { code?: string })();
    (notApproved as { code?: string }).code = "PROVIDER_NOT_APPROVED";
    requireApprovedProviderMock.mockRejectedValueOnce(notApproved);
    expect(await addVehicleToTourServicePool("svc-1", "veh-1")).toEqual({ ok: false, error: "PROVIDER_NOT_APPROVED" });

    requireApprovedProviderMock.mockRejectedValueOnce(new (ForbiddenError as new () => Error)());
    expect(await addVehicleToTourServicePool("svc-1", "veh-1")).toEqual({ ok: false, error: "NO_PROVIDER_PROFILE" });

    requireApprovedProviderMock.mockRejectedValueOnce(new (UnauthenticatedError as new () => Error)());
    await expect(addVehicleToTourServicePool("svc-1", "veh-1")).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});
