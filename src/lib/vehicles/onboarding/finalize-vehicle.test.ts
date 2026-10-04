import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("server-only", () => ({}));
const requireApprovedProviderMock = vi.fn();
class ForbiddenError extends Error {
  code?: string;
  constructor(m: string, code?: string) {
    super(m);
    this.code = code;
  }
}
class UnauthenticatedError extends Error {}
vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a),
  ForbiddenError,
  UnauthenticatedError,
}));
// The rental-workspace predicate must play NO part in vehicle registration: if any onboarding code
// ever consults it again, this mock throws and the suite fails.
const rentalPredicateMock = vi.fn(() => {
  throw new Error("vehicle registration must never consult the rental workspace predicate");
});
vi.mock("@/lib/offerings/rental/provider/rental-workspace-access", () => ({
  canViewRentalWorkspace: () => rentalPredicateMock(),
  resolveRentalWorkspaceViewAccess: () => rentalPredicateMock(),
}));
const auditMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: (...a: unknown[]) => auditMock(...a) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const assetFindFirst = vi.fn();
const confCreate = vi.fn();
const confUpdateMany = vi.fn();
const vehicleUpdate = vi.fn();
const txClient = {
  $queryRaw: async () => [], // the asset row lock (SELECT … FOR UPDATE)
  asset: { findFirst: (...a: unknown[]) => assetFindFirst(...a) },
  vehicleRegistrationConfirmation: { create: (...a: unknown[]) => confCreate(...a), updateMany: (...a: unknown[]) => confUpdateMany(...a) },
  vehicle: { update: (...a: unknown[]) => vehicleUpdate(...a) },
};
const transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(txClient));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: (cb: (tx: unknown) => unknown) => transaction(cb) } }));

const { finalizeVehicleFromRegistration } = await import("./finalize-vehicle");

const VEHICLE = "11111111-1111-1111-1111-111111111111";

const extractionFields: Record<string, { rawValue: string | null; normalizedValue: string | number | null; confidence: string; warnings: string[] }> = Object.fromEntries(
  ["plateNumber", "plateType", "makeDescription", "model", "color", "usageClassification", "manufactureYear", "engineCapacity", "emptyWeight", "maximumLoad", "axleCount", "licensedPassengerCapacity", "vin", "engineNumber", "licenseValidFrom", "licenseExpiry", "firstRegistrationDate"].map(
    (k) => [k, { rawValue: null, normalizedValue: null as string | number | null, confidence: "LOW", warnings: [] as string[] }],
  ),
);

const assetRow = (confirmations: unknown[] = [], vehicle: Record<string, unknown> = { assetId: VEHICLE, make: null, vehicleType: null }) => ({
  id: VEHICLE,
  vehicle,
  documents: [
    {
      id: "doc-1",
      registrationExtraction: { id: "ext-1", documentSha256: "sha-current", parserVersion: "1.0.0", fields: extractionFields },
      registrationConfirmations: confirmations,
    },
  ],
});

const FULL: Record<string, unknown> = {
  make: "Toyota",
  model: "Land Cruiser",
  modelYear: "2019",
  color: "White",
  bookablePassengerCapacity: "13",
  licensedPassengerCapacity: "13",
  registeredSeats: "15",
  plateNumber: "A 12345",
  vin: "JTEBU29J8K5012345",
  licenseExpiry: "31/05/2027",
  vehicleType: "SUV",
  declarationAccepted: "true",
};

const lockedColumns = {
  make: "Toyota", model: "Land Cruiser", modelYear: 2019, color: "White",
  bookablePassengerCapacity: 13, licensedPassengerCapacity: 13, registeredSeats: 15,
  plateNumber: "A12345", plateType: null, vin: "JTEBU29J8K5012345", engineNumber: null,
  usageClassification: null, engineCapacity: null, emptyWeight: null, maximumLoad: null,
  axleCount: null, licenseValidFrom: null, licenseExpiry: "2027-05-31", firstRegistrationDate: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  requireApprovedProviderMock.mockResolvedValue({ barqUser: { id: "22222222-2222-2222-2222-222222222222" }, provider: { id: "prov-1", status: "APPROVED" } });
  assetFindFirst.mockResolvedValue(assetRow([]));
  confCreate.mockResolvedValue({ id: "conf-1" });
  confUpdateMany.mockResolvedValue({ count: 1 });
  vehicleUpdate.mockResolvedValue({ assetId: VEHICLE });
});

describe("finalizeVehicleFromRegistration", () => {
  it("an approved provider WITHOUT any rental vertical (e.g. a tourist guide) can finalize — the rental predicate is never consulted", async () => {
    const res = await finalizeVehicleFromRegistration(VEHICLE, FULL);
    expect(res).toEqual({ ok: true, vehicleId: VEHICLE, alreadyCreated: false });
    expect(rentalPredicateMock).not.toHaveBeenCalled();
  });

  it("non-approved provider (ForbiddenError) → PROVIDER_NOT_APPROVED, no transaction", async () => {
    requireApprovedProviderMock.mockRejectedValue(new ForbiddenError("no", "PROVIDER_NOT_APPROVED"));
    expect(await finalizeVehicleFromRegistration(VEHICLE, FULL)).toEqual({ ok: false, code: "PROVIDER_NOT_APPROVED" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("writes the provider's ADVISORY 4x4 declaration + description, and never the trusted fourByFourVerified", async () => {
    await finalizeVehicleFromRegistration(VEHICLE, { ...FULL, vehicleType: "FOUR_BY_FOUR", claimedFourByFour: true, publicDescription: "  Clean and comfortable  " });
    const vData = (vehicleUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(vData).toMatchObject({ vehicleType: "FOUR_BY_FOUR", claimedFourByFour: true, publicDescription: "Clean and comfortable" });
    expect(vData).not.toHaveProperty("fourByFourVerified");
  });

  it("no 4x4 declaration / blank description → stored as null (never invented)", async () => {
    await finalizeVehicleFromRegistration(VEHICLE, { ...FULL, publicDescription: "   " });
    const vData = (vehicleUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(vData.claimedFourByFour).toBeNull();
    expect(vData.publicDescription).toBeNull();
  });

  it("a description containing markup → INVALID_INPUT with a publicDescription field error, no transaction", async () => {
    const res = await finalizeVehicleFromRegistration(VEHICLE, { ...FULL, publicDescription: "<script>x</script>" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors?.some((e) => e.field === "publicDescription")).toBe(true);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("registering a vehicle writes ONLY the Vehicle + its confirmation claim (no vertical / category / offering write is even possible)", async () => {
    await finalizeVehicleFromRegistration(VEHICLE, FULL);
    // The transaction client exposes only these models; touching anything else would throw.
    expect(Object.keys(txClient).sort()).toEqual(["$queryRaw", "asset", "vehicle", "vehicleRegistrationConfirmation"]);
  });

  it("invalid confirmation (declaration not accepted) → INVALID_INPUT, no transaction", async () => {
    const res = await finalizeVehicleFromRegistration(VEHICLE, { ...FULL, declarationAccepted: "false" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_INPUT");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("missing vehicleType → INVALID_INPUT with a vehicleType field error", async () => {
    const { vehicleType, ...noType } = FULL;
    void vehicleType;
    const res = await finalizeVehicleFromRegistration(VEHICLE, noType);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("INVALID_INPUT");
      expect(res.fieldErrors?.some((e) => e.field === "vehicleType")).toBe(true);
    }
    expect(transaction).not.toHaveBeenCalled();
  });

  it("invalid vehicleType (not a canonical code) → INVALID_INPUT", async () => {
    const res = await finalizeVehicleFromRegistration(VEHICLE, { ...FULL, vehicleType: "SPACESHIP" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_INPUT");
  });

  it("fresh (no active claim) → creates SUBMITTED + applies confirmed values to the Vehicle (plate→registrationNumber, type) + metadata-only audit", async () => {
    const res = await finalizeVehicleFromRegistration(VEHICLE, FULL);
    expect(res).toEqual({ ok: true, vehicleId: VEHICLE, alreadyCreated: false });

    const confData = (confCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(confData).toMatchObject({ status: "SUBMITTED", submittedByUserId: "22222222-2222-2222-2222-222222222222", assetId: VEHICLE, assetDocumentId: "doc-1", extractionId: "ext-1" });

    const vData = (vehicleUpdate.mock.calls[0]?.[0] as { where: unknown; data: Record<string, unknown> }).data;
    expect(vData).toMatchObject({ make: "Toyota", model: "Land Cruiser", modelYear: 2019, color: "White", vehicleType: "SUV", registrationNumber: "A 12345", bookablePassengerCapacity: 13, licensedPassengerCapacity: 13, registeredSeats: 15 });

    const audit = auditMock.mock.calls.at(-1)?.[0] as { action: string; newValue: Record<string, unknown> };
    expect(audit.action).toBe("vehicle.created_from_registration");
    expect(Object.keys(audit.newValue).sort()).toEqual(["correctedFields", "vehicleType"].sort());
    expect(JSON.stringify(audit.newValue)).not.toContain("JTEBU29J8K5012345"); // no VIN
    expect(JSON.stringify(audit.newValue)).not.toContain("A12345"); // no plate
  });

  it("active DRAFT (not stale) → locks to SUBMITTED with a version CAS, then writes the Vehicle", async () => {
    assetFindFirst.mockResolvedValue(assetRow([{ id: "conf-d", status: "DRAFT", version: 2, boundDocumentSha256: "sha-current", boundParserVersion: "1.0.0", ...lockedColumns }]));
    const res = await finalizeVehicleFromRegistration(VEHICLE, FULL);
    expect(res).toEqual({ ok: true, vehicleId: VEHICLE, alreadyCreated: false });
    expect(confUpdateMany.mock.calls[0]?.[0]).toMatchObject({ where: { id: "conf-d", version: 2 }, data: { status: "SUBMITTED", version: 3 } });
    expect(confCreate).not.toHaveBeenCalled();
    expect(vehicleUpdate).toHaveBeenCalledTimes(1);
  });

  it("active DRAFT version CAS loses (count 0) → CONFLICT, no Vehicle write", async () => {
    assetFindFirst.mockResolvedValue(assetRow([{ id: "conf-d", status: "DRAFT", version: 2, boundDocumentSha256: "sha-current", boundParserVersion: "1.0.0", ...lockedColumns }]));
    confUpdateMany.mockResolvedValue({ count: 0 });
    const res = await finalizeVehicleFromRegistration(VEHICLE, FULL);
    expect(res).toEqual({ ok: false, code: "CONFLICT" });
    expect(vehicleUpdate).not.toHaveBeenCalled();
  });

  it("already SUBMITTED (not stale) → idempotent alreadyCreated, re-applies the LOCKED columns, no new claim", async () => {
    assetFindFirst.mockResolvedValue(
      assetRow([{ id: "conf-s", status: "SUBMITTED", version: 1, boundDocumentSha256: "sha-current", boundParserVersion: "1.0.0", ...lockedColumns }], { assetId: VEHICLE, make: "Toyota", vehicleType: "SUV" }),
    );
    const res = await finalizeVehicleFromRegistration(VEHICLE, FULL);
    expect(res).toEqual({ ok: true, vehicleId: VEHICLE, alreadyCreated: true });
    expect(confCreate).not.toHaveBeenCalled();
    expect(confUpdateMany).not.toHaveBeenCalled();
    const vData = (vehicleUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(vData).toMatchObject({ registrationNumber: "A12345", vehicleType: "SUV" });
  });

  it("document replaced since review (stale) → SUPERSEDED, no Vehicle write", async () => {
    assetFindFirst.mockResolvedValue(assetRow([{ id: "conf-old", status: "SUBMITTED", version: 3, boundDocumentSha256: "sha-OLD", boundParserVersion: "1.0.0", ...lockedColumns }]));
    const res = await finalizeVehicleFromRegistration(VEHICLE, FULL);
    expect(res).toEqual({ ok: false, code: "SUPERSEDED" });
    expect(confUpdateMany.mock.calls[0]?.[0]).toMatchObject({ where: { id: "conf-old", version: 3, status: { not: "SUPERSEDED" } }, data: { status: "SUPERSEDED" } });
    expect(vehicleUpdate).not.toHaveBeenCalled();
  });

  it("duplicate plate (P2002 on registrationNumber) → DUPLICATE_REGISTRATION", async () => {
    vehicleUpdate.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("u", { code: "P2002", clientVersion: "5.22.0", meta: { target: ["registrationNumber"] } }));
    expect(await finalizeVehicleFromRegistration(VEHICLE, FULL)).toEqual({ ok: false, code: "DUPLICATE_REGISTRATION" });
  });

  it("concurrent claim create (P2002 on the partial-unique) → CONFLICT", async () => {
    confCreate.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("u", { code: "P2002", clientVersion: "5.22.0", meta: { target: "vehicle_registration_confirmations_active_doc_key" } }));
    expect(await finalizeVehicleFromRegistration(VEHICLE, FULL)).toEqual({ ok: false, code: "CONFLICT" });
  });

  it("no extraction yet → EXTRACTION_NOT_READY", async () => {
    assetFindFirst.mockResolvedValue({ id: VEHICLE, vehicle: { assetId: VEHICLE, make: null, vehicleType: null }, documents: [{ id: "doc-1", registrationExtraction: null, registrationConfirmations: [] }] });
    expect(await finalizeVehicleFromRegistration(VEHICLE, FULL)).toEqual({ ok: false, code: "EXTRACTION_NOT_READY" });
  });

  it("no registration document → DOCUMENT_NOT_FOUND", async () => {
    assetFindFirst.mockResolvedValue({ id: VEHICLE, vehicle: { assetId: VEHICLE, make: null, vehicleType: null }, documents: [] });
    expect(await finalizeVehicleFromRegistration(VEHICLE, FULL)).toEqual({ ok: false, code: "DOCUMENT_NOT_FOUND" });
  });

  it("foreign/missing vehicle → VEHICLE_NOT_FOUND", async () => {
    assetFindFirst.mockResolvedValue(null);
    expect(await finalizeVehicleFromRegistration(VEHICLE, FULL)).toEqual({ ok: false, code: "VEHICLE_NOT_FOUND" });
  });

  it("invalid uuid → VEHICLE_NOT_FOUND (non-enumerating, no auth call)", async () => {
    expect(await finalizeVehicleFromRegistration("not-a-uuid", FULL)).toEqual({ ok: false, code: "VEHICLE_NOT_FOUND" });
    expect(requireApprovedProviderMock).not.toHaveBeenCalled();
  });
});
