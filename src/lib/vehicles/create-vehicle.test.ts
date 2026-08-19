import { describe, it, expect, vi, afterEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("server-only", () => ({}));

const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a),
  ForbiddenError: class ForbiddenError extends Error {
    code?: string;
    constructor(message?: string, code?: string) {
      super(message);
      this.code = code;
    }
  },
}));

const assetCreateMock = vi.fn();
const vehicleCreateMock = vi.fn();
const auditCreateMock = vi.fn();
const providerCategoryCreateMock = vi.fn();
const serviceCreateMock = vi.fn();
const bookingCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        asset: { create: (...a: unknown[]) => assetCreateMock(...a) },
        vehicle: { create: (...a: unknown[]) => vehicleCreateMock(...a) },
        auditLog: { create: (...a: unknown[]) => auditCreateMock(...a) },
        providerCategory: { create: (...a: unknown[]) => providerCategoryCreateMock(...a) },
        service: { create: (...a: unknown[]) => serviceCreateMock(...a) },
        booking: { create: (...a: unknown[]) => bookingCreateMock(...a) },
      }),
  },
}));

const { createVehicle } = await import("./create-vehicle");

const VALID = {
  make: "Toyota",
  model: "Land Cruiser",
  modelYear: 2025,
  color: "White",
  vehicleType: "FOUR_BY_FOUR",
  passengerCapacity: 6,
  publicDescription: null,
  registrationNumber: null,
};

afterEach(() => {
  requireApprovedProviderMock.mockReset();
  assetCreateMock.mockReset();
  vehicleCreateMock.mockReset();
  auditCreateMock.mockReset();
  providerCategoryCreateMock.mockReset();
  serviceCreateMock.mockReset();
  bookingCreateMock.mockReset();
});

function approvedProvider(id = "prov-1") {
  requireApprovedProviderMock.mockResolvedValue({ provider: { id } });
  assetCreateMock.mockResolvedValue({ id: "asset-1" });
  vehicleCreateMock.mockResolvedValue({});
  auditCreateMock.mockResolvedValue({});
}

describe("createVehicle — ownership + server-authoritative fields", () => {
  it("an approved provider creates their own vehicle (Asset VEHICLE/REGISTERED + Vehicle), audited", async () => {
    approvedProvider("prov-1");
    const result = await createVehicle(VALID);
    expect(result).toEqual({ ok: true, vehicleId: "asset-1" });
    expect(assetCreateMock).toHaveBeenCalledWith({ data: { providerId: "prov-1", assetType: "VEHICLE", status: "REGISTERED" } });
    expect(vehicleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ assetId: "asset-1", make: "Toyota", vehicleType: "FOUR_BY_FOUR", passengerCapacity: 6 }),
    });
    expect(auditCreateMock).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "vehicle.created", entityType: "Vehicle", entityId: "asset-1" }) });
  });

  it("derives providerId from the session — a client-supplied providerId is rejected as an unknown key", async () => {
    approvedProvider("prov-real");
    const result = await createVehicle({ ...VALID, providerId: "attacker" });
    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(assetCreateMock).not.toHaveBeenCalled();
  });

  it("never writes the raw registration number into the audit log", async () => {
    approvedProvider();
    await createVehicle({ ...VALID, registrationNumber: "OM 999" });
    const auditData = auditCreateMock.mock.calls[0]![0].data;
    expect(JSON.stringify(auditData)).not.toContain("OM 999");
    expect(auditData.newValue.hasRegistration).toBe(true);
  });
});

describe("createVehicle — multi-vehicle (no one-vehicle cap)", () => {
  it("lets the same provider create multiple vehicles", async () => {
    approvedProvider("prov-1");
    expect((await createVehicle(VALID)).ok).toBe(true);
    expect((await createVehicle({ ...VALID, make: "Nissan", model: "Patrol" })).ok).toBe(true);
    expect(assetCreateMock).toHaveBeenCalledTimes(2);
  });
});

describe("createVehicle — B4/B5 isolation (grants zero commercial authorization)", () => {
  it("creating a vehicle never mutates ProviderCategory, Service, or Booking", async () => {
    approvedProvider();
    await createVehicle(VALID);
    expect(providerCategoryCreateMock).not.toHaveBeenCalled();
    expect(serviceCreateMock).not.toHaveBeenCalled();
    expect(bookingCreateMock).not.toHaveBeenCalled();
  });
});

describe("createVehicle — duplicate registration + gates", () => {
  it("maps a unique-violation (P2002) to a generic DUPLICATE_REGISTRATION (never reveals the owner)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    assetCreateMock.mockResolvedValue({ id: "asset-1" });
    vehicleCreateMock.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "5.22.0" }));
    const result = await createVehicle({ ...VALID, registrationNumber: "OM 12345" });
    expect(result).toEqual({ ok: false, error: "DUPLICATE_REGISTRATION" });
  });

  it("rejects invalid input before any auth or write", async () => {
    const result = await createVehicle({ ...VALID, passengerCapacity: 0 });
    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireApprovedProviderMock).not.toHaveBeenCalled();
  });

  it("maps a not-approved provider to PROVIDER_NOT_APPROVED", async () => {
    const { ForbiddenError } = await import("@/lib/auth");
    requireApprovedProviderMock.mockRejectedValue(new (ForbiddenError as new (m?: string, c?: string) => Error)("nope", "PROVIDER_NOT_APPROVED"));
    const result = await createVehicle(VALID);
    expect(result).toEqual({ ok: false, error: "PROVIDER_NOT_APPROVED" });
  });
});
