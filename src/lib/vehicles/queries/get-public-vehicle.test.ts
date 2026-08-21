import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/uuid", () => ({ isValidUuid: (v: unknown) => typeof v === "string" && v.length > 0 }));

const vehicleFindFirstMock = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { vehicle: { findFirst: (...a: unknown[]) => vehicleFindFirstMock(...a) } } }));

const { getPublicVehicle } = await import("./get-public-vehicle");

// A fully-selectable asset: ACTIVE + APPROVED verification + BOTH required docs
// (registration + insurance) APPROVED and unexpired.
const approvedDocs = [
  { type: "VEHICLE_REGISTRATION", status: "APPROVED", expiresAt: null },
  { type: "VEHICLE_INSURANCE", status: "APPROVED", expiresAt: new Date("2030-01-01T00:00:00Z") },
];

const row = (over: { status?: string; verificationStatus?: string; documents?: unknown[] } = {}) => ({
  assetId: "asset-1",
  make: "Toyota",
  model: "Land Cruiser",
  modelYear: 2025,
  color: "White",
  vehicleType: "FOUR_BY_FOUR",
  passengerCapacity: 6,
  publicDescription: "Desert-ready.",
  registrationNumber: "OM 12345",
  createdAt: new Date(),
  updatedAt: new Date(),
  asset: {
    status: over.status ?? "ACTIVE",
    providerId: "prov-1",
    verificationStatus: over.verificationStatus ?? "APPROVED",
    documents: over.documents ?? approvedDocs,
  },
});

afterEach(() => vehicleFindFirstMock.mockReset());

describe("getPublicVehicle — fail-closed computed selectability (ACTIVE + APPROVED + docs)", () => {
  it("returns ONLY the public allowlist when fully selectable (no registration/status/objectKey)", async () => {
    vehicleFindFirstMock.mockResolvedValue(row());
    const dto = await getPublicVehicle("asset-1");
    expect(dto).not.toBeNull();
    expect(Object.keys(dto!).sort()).toEqual(
      ["color", "id", "isFourByFour", "make", "model", "modelYear", "passengerCapacity", "publicDescription", "vehicleType"].sort(),
    );
    expect(JSON.stringify(dto)).not.toContain("OM 12345");
    // Never selects objectKey (query safety) — assert the select shape.
    const select = vehicleFindFirstMock.mock.calls[0]![0].include.asset.select;
    expect(select.documents.select.objectKey).toBeUndefined();
    expect(select.documents.select).toEqual({ type: true, status: true, expiresAt: true });
  });

  it("returns null when NOT active (REGISTERED) even if verified + docs valid", async () => {
    vehicleFindFirstMock.mockResolvedValue(row({ status: "REGISTERED" }));
    expect(await getPublicVehicle("asset-1")).toBeNull();
  });

  it("returns null when verification is not APPROVED", async () => {
    vehicleFindFirstMock.mockResolvedValue(row({ verificationStatus: "DRAFT" }));
    expect(await getPublicVehicle("asset-1")).toBeNull();
  });

  it("returns null when a required document is missing (fail-closed until documents exist)", async () => {
    vehicleFindFirstMock.mockResolvedValue(row({ documents: [] }));
    expect(await getPublicVehicle("asset-1")).toBeNull();
  });

  it("returns null when a required document is expired", async () => {
    vehicleFindFirstMock.mockResolvedValue(
      row({
        documents: [
          { type: "VEHICLE_REGISTRATION", status: "APPROVED", expiresAt: null },
          { type: "VEHICLE_INSURANCE", status: "APPROVED", expiresAt: new Date("2000-01-01T00:00:00Z") },
        ],
      }),
    );
    expect(await getPublicVehicle("asset-1")).toBeNull();
  });

  it("returns null for a missing vehicle or malformed id", async () => {
    vehicleFindFirstMock.mockResolvedValue(null);
    expect(await getPublicVehicle("asset-x")).toBeNull();
    expect(await getPublicVehicle("")).toBeNull();
  });
});
