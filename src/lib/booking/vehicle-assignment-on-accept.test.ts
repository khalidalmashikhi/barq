import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The resolver COMPOSES the real authorities (loadOwnedTourServiceContext →
// parseGuidingContent → TOUR_PACKAGE_SEMANTICS; evaluatePoolVehicle →
// getVehicleAssignmentBlockers). Everything runs real here — only the db client is a
// hand-built stub, so this is a true end-to-end unit of the acceptance vehicle policy.
const { resolveVehicleAssignmentForAcceptance } = await import("./vehicle-assignment-on-accept");

const FUTURE = new Date("2027-01-01T00:00:00.000Z");
const PAST = new Date("2026-01-01T00:00:00.000Z");

const PROVIDER = "prov-1";
const SERVICE = "svc-1";
const VEHICLE = "019f4e4e-9000-7052-b15e-b79b5ccb1aaa";

function guidingContent(packageType: string, maxGuests: number | null = null) {
  const transport = packageType === "GUIDE_WITH_TRANSPORT" || packageType === "GUIDE_WITH_4X4";
  const vehicle = transport
    ? { type: packageType === "GUIDE_WITH_4X4" ? "FOUR_BY_FOUR" : "SUV", make: null, model: null, year: null, passengerCapacity: null }
    : null;
  return {
    version: 1, packageType, durationMinutes: null, meetingPoint: null,
    pickup: { included: false, area: null, hotelPickup: false, airportPickup: false },
    maxGuests, languages: [], itinerary: [], includedItems: [], excludedItems: [],
    difficulty: null, childFriendly: null, privateTour: null, recommendedEquipment: [], refreshmentsIncluded: null,
    importantNotes: null, vehicle,
  };
}

function vehicleRow(over: { asset?: Record<string, unknown>; vehicle?: Record<string, unknown> } = {}) {
  return {
    vehicle: {
      assetId: VEHICLE, make: "Toyota", model: "Prado", modelYear: 2024, color: "White", vehicleType: "SUV",
      passengerCapacity: 6, publicDescription: null, registrationNumber: "OM 12345",
      claimedFourByFour: true, fourByFourVerified: null,
      createdAt: PAST, updatedAt: PAST,
      asset: {
        status: "ACTIVE", providerId: PROVIDER, verificationStatus: "APPROVED",
        documents: [
          { type: "VEHICLE_REGISTRATION", status: "APPROVED", expiresAt: FUTURE },
          { type: "VEHICLE_INSURANCE", status: "APPROVED", expiresAt: FUTURE },
        ],
        ...over.asset,
      },
      ...over.vehicle,
    },
  };
}

// db stub — service.findFirst returns the tour context; tourServiceVehicle.findFirst returns
// the pooled row (or null = not pooled).
function makeDb(opts: { packageType?: string; maxGuests?: number | null; experience?: "none" | "present"; poolRow?: unknown }) {
  const experience = opts.experience ?? "present";
  return {
    service: {
      findFirst: async () =>
        experience === "none"
          ? { id: SERVICE, providerId: PROVIDER, experience: null }
          : { id: SERVICE, providerId: PROVIDER, experience: { guidingContent: guidingContent(opts.packageType!, opts.maxGuests ?? null) } },
    },
    tourServiceVehicle: { findFirst: async () => opts.poolRow ?? null },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const base = (db: unknown, over: Record<string, unknown> = {}) => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: db as any,
  serviceId: SERVICE,
  providerId: PROVIDER,
  seats: 4,
  vehicleId: VEHICLE as string | null,
  ...over,
});

describe("resolveVehicleAssignmentForAcceptance — BOOKING-VEHICLE-1", () => {
  it("non-tour service → no vehicle (id ignored)", async () => {
    const db = makeDb({ experience: "none" });
    expect(await resolveVehicleAssignmentForAcceptance(base(db))).toEqual({ ok: true, vehicleId: null });
  });

  it("GUIDE_ONLY → vehicle forbidden; id ignored, pool never consulted", async () => {
    const db = makeDb({ packageType: "GUIDE_ONLY", poolRow: vehicleRow() });
    expect(await resolveVehicleAssignmentForAcceptance(base(db))).toEqual({ ok: true, vehicleId: null });
  });

  it("GUIDE_WITH_TRANSPORT + no vehicle → VEHICLE_REQUIRED", async () => {
    const db = makeDb({ packageType: "GUIDE_WITH_TRANSPORT" });
    expect(await resolveVehicleAssignmentForAcceptance(base(db, { vehicleId: null }))).toEqual({
      ok: false, error: "VEHICLE_REQUIRED",
    });
  });

  it("malformed vehicleId → INVALID_INPUT (for a vehicle-taking package)", async () => {
    const db = makeDb({ packageType: "GUIDE_WITH_TRANSPORT" });
    expect(await resolveVehicleAssignmentForAcceptance(base(db, { vehicleId: "not-a-uuid" }))).toEqual({
      ok: false, error: "INVALID_INPUT",
    });
  });

  it("vehicle not in the service pool → VEHICLE_NOT_IN_SERVICE_POOL (foreign & unpooled are uniform)", async () => {
    const db = makeDb({ packageType: "GUIDE_WITH_TRANSPORT", poolRow: null });
    expect(await resolveVehicleAssignmentForAcceptance(base(db))).toEqual({
      ok: false, error: "VEHICLE_NOT_IN_SERVICE_POOL",
    });
  });

  it("pooled row whose asset belongs to another provider → VEHICLE_NOT_IN_SERVICE_POOL (no leak)", async () => {
    const db = makeDb({ packageType: "GUIDE_WITH_TRANSPORT", poolRow: vehicleRow({ asset: { providerId: "other" } }) });
    expect(await resolveVehicleAssignmentForAcceptance(base(db))).toEqual({
      ok: false, error: "VEHICLE_NOT_IN_SERVICE_POOL",
    });
  });

  it("GUIDE_WITH_TRANSPORT + eligible pooled vehicle → ok with the vehicleId", async () => {
    const db = makeDb({ packageType: "GUIDE_WITH_TRANSPORT", poolRow: vehicleRow() });
    expect(await resolveVehicleAssignmentForAcceptance(base(db))).toEqual({ ok: true, vehicleId: VEHICLE });
  });

  it("inactive vehicle → VEHICLE_NOT_ELIGIBLE", async () => {
    const db = makeDb({ packageType: "GUIDE_WITH_TRANSPORT", poolRow: vehicleRow({ asset: { status: "REGISTERED" } }) });
    expect(await resolveVehicleAssignmentForAcceptance(base(db))).toEqual({ ok: false, error: "VEHICLE_NOT_ELIGIBLE" });
  });

  it("verification not approved → VEHICLE_NOT_ELIGIBLE", async () => {
    const db = makeDb({ packageType: "GUIDE_WITH_TRANSPORT", poolRow: vehicleRow({ asset: { verificationStatus: "SUBMITTED" } }) });
    expect(await resolveVehicleAssignmentForAcceptance(base(db))).toEqual({ ok: false, error: "VEHICLE_NOT_ELIGIBLE" });
  });

  it("required document expired → VEHICLE_NOT_ELIGIBLE", async () => {
    const db = makeDb({
      packageType: "GUIDE_WITH_TRANSPORT",
      poolRow: vehicleRow({
        asset: {
          documents: [
            { type: "VEHICLE_REGISTRATION", status: "APPROVED", expiresAt: PAST },
            { type: "VEHICLE_INSURANCE", status: "APPROVED", expiresAt: FUTURE },
          ],
        },
      }),
    });
    expect(await resolveVehicleAssignmentForAcceptance(base(db))).toEqual({ ok: false, error: "VEHICLE_NOT_ELIGIBLE" });
  });

  it("capacity: seats > passengerCapacity → VEHICLE_CAPACITY_INSUFFICIENT (sole blocker)", async () => {
    const db = makeDb({ packageType: "GUIDE_WITH_TRANSPORT", poolRow: vehicleRow() });
    expect(await resolveVehicleAssignmentForAcceptance(base(db, { seats: 7 }))).toEqual({
      ok: false, error: "VEHICLE_CAPACITY_INSUFFICIENT",
    });
  });

  it("capacity: seats == passengerCapacity → ok", async () => {
    const db = makeDb({ packageType: "GUIDE_WITH_TRANSPORT", poolRow: vehicleRow() });
    expect(await resolveVehicleAssignmentForAcceptance(base(db, { seats: 6 }))).toEqual({ ok: true, vehicleId: VEHICLE });
  });

  it("GUIDE_WITH_4X4: trusted-null vehicle → VEHICLE_NOT_ELIGIBLE; trusted-true → ok", async () => {
    const notTrusted = makeDb({ packageType: "GUIDE_WITH_4X4", poolRow: vehicleRow({ vehicle: { fourByFourVerified: null } }) });
    expect(await resolveVehicleAssignmentForAcceptance(base(notTrusted))).toEqual({ ok: false, error: "VEHICLE_NOT_ELIGIBLE" });

    const trusted = makeDb({ packageType: "GUIDE_WITH_4X4", poolRow: vehicleRow({ vehicle: { fourByFourVerified: true } }) });
    expect(await resolveVehicleAssignmentForAcceptance(base(trusted))).toEqual({ ok: true, vehicleId: VEHICLE });
  });

  it("PRIVATE_CUSTOM_TOUR: no vehicle → ok(null); eligible vehicle → ok(id)", async () => {
    const none = makeDb({ packageType: "PRIVATE_CUSTOM_TOUR" });
    expect(await resolveVehicleAssignmentForAcceptance(base(none, { vehicleId: null }))).toEqual({ ok: true, vehicleId: null });

    const withV = makeDb({ packageType: "PRIVATE_CUSTOM_TOUR", poolRow: vehicleRow() });
    expect(await resolveVehicleAssignmentForAcceptance(base(withV))).toEqual({ ok: true, vehicleId: VEHICLE });
  });
});
