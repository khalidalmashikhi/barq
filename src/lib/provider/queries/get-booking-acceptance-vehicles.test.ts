import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const requireProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireProvider: (...a: unknown[]) => requireProviderMock(...a) }));

const bookingFindFirstMock = vi.fn();
const serviceFindFirstMock = vi.fn();
const poolFindManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    booking: { findFirst: (...a: unknown[]) => bookingFindFirstMock(...a) },
    service: { findFirst: (...a: unknown[]) => serviceFindFirstMock(...a) },
    tourServiceVehicle: { findMany: (...a: unknown[]) => poolFindManyMock(...a) },
  },
}));

// BOOKING-CONFLICT-1C — the reservation busy-lookup is its own unit (see
// vehicle-reservation/find-busy-vehicles.test.ts). Mocked here; default = nothing busy.
const findBusyMock = vi.fn();
vi.mock("@/lib/booking/vehicle-reservation", () => ({
  findBusyVehicleIdsForInterval: (...a: unknown[]) => findBusyMock(...a),
}));

// loadOwnedTourServiceContext (via service.findFirst + parseGuidingContent) and
// evaluatePoolVehicle run REAL — only prisma + auth are mocked.
const { getBookingAcceptanceVehicleOptions } = await import("./get-booking-acceptance-vehicles");

const FUTURE = new Date("2027-01-01T00:00:00.000Z");
const PAST = new Date("2026-01-01T00:00:00.000Z");
const BOOKING = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
const PROVIDER = "prov-1";

function guidingContent(packageType: string) {
  const transport = packageType === "GUIDE_WITH_TRANSPORT" || packageType === "GUIDE_WITH_4X4";
  return {
    version: 1, packageType, durationMinutes: null, meetingPoint: null,
    pickup: { included: false, area: null, hotelPickup: false, airportPickup: false },
    maxGuests: null, languages: [], itinerary: [], includedItems: [], excludedItems: [],
    difficulty: null, childFriendly: null, privateTour: null, recommendedEquipment: [], refreshmentsIncluded: null,
    importantNotes: null,
    vehicle: transport ? { type: "SUV", make: null, model: null, year: null, passengerCapacity: null } : null,
  };
}

function poolRow(assetId: string, over: { asset?: Record<string, unknown>; vehicle?: Record<string, unknown> } = {}) {
  return {
    vehicle: {
      assetId, make: "Toyota", model: "Prado", modelYear: 2024, color: "White", vehicleType: "SUV",
      passengerCapacity: 6, publicDescription: null, registrationNumber: "OM 99999",
      claimedFourByFour: true, fourByFourVerified: null, createdAt: PAST, updatedAt: PAST,
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

afterEach(() => {
  requireProviderMock.mockReset();
  bookingFindFirstMock.mockReset();
  serviceFindFirstMock.mockReset();
  poolFindManyMock.mockReset();
  findBusyMock.mockReset();
});

beforeEach(() => {
  // Default: nothing busy (matches the pre-1C behavior for every existing test).
  findBusyMock.mockResolvedValue(new Set<string>());
});

function primeBooking(status = "PENDING_PROVIDER", seats = 4, operationalStartAt: Date | null = null) {
  requireProviderMock.mockResolvedValue({ provider: { id: PROVIDER } });
  // A slot-based booking carries BOTH interval bounds; slotless carries neither.
  const operationalEndAt = operationalStartAt ? new Date(operationalStartAt.getTime() + 3 * 3600_000) : null;
  bookingFindFirstMock.mockResolvedValue({ id: BOOKING, serviceId: "svc-1", seats, status, operationalStartAt, operationalEndAt });
}

describe("getBookingAcceptanceVehicleOptions — BOOKING-VEHICLE-1", () => {
  it("returns null for a malformed booking id (no queries)", async () => {
    expect(await getBookingAcceptanceVehicleOptions("nope")).toBeNull();
    expect(requireProviderMock).not.toHaveBeenCalled();
  });

  it("returns null for a missing / not-owned booking", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: PROVIDER } });
    bookingFindFirstMock.mockResolvedValue(null);
    expect(await getBookingAcceptanceVehicleOptions(BOOKING)).toBeNull();
  });

  it("returns null when the booking isn't awaiting the provider", async () => {
    primeBooking("CONFIRMED");
    expect(await getBookingAcceptanceVehicleOptions(BOOKING)).toBeNull();
    expect(serviceFindFirstMock).not.toHaveBeenCalled();
  });

  it("returns null for a non-tour service (no selector)", async () => {
    primeBooking();
    serviceFindFirstMock.mockResolvedValue({ id: "svc-1", providerId: PROVIDER, experience: null });
    expect(await getBookingAcceptanceVehicleOptions(BOOKING)).toBeNull();
  });

  it("returns null for GUIDE_ONLY (vehicle forbidden — no selector)", async () => {
    primeBooking();
    serviceFindFirstMock.mockResolvedValue({ id: "svc-1", providerId: PROVIDER, experience: { guidingContent: guidingContent("GUIDE_ONLY") } });
    expect(await getBookingAcceptanceVehicleOptions(BOOKING)).toBeNull();
  });

  it("GUIDE_WITH_TRANSPORT: lists pooled candidates with live eligibility and no private fields", async () => {
    primeBooking("PENDING_PROVIDER", 4);
    serviceFindFirstMock.mockResolvedValue({ id: "svc-1", providerId: PROVIDER, experience: { guidingContent: guidingContent("GUIDE_WITH_TRANSPORT") } });
    poolFindManyMock.mockResolvedValue([
      poolRow("veh-eligible"),
      poolRow("veh-inactive", { asset: { status: "REGISTERED" } }),
    ]);

    const options = await getBookingAcceptanceVehicleOptions(BOOKING);
    expect(options).not.toBeNull();
    expect(options!.vehicleRequired).toBe(true);
    expect(options!.requiresFourByFour).toBe(false);
    // BOOKING-INTERVAL-1 — slotless transport (no interval) → the provider must schedule it.
    expect(options!.requiresSchedule).toBe(true);
    expect(options!.seats).toBe(4);
    expect(options!.candidates.map((c) => [c.vehicleId, c.eligible])).toEqual([
      ["veh-eligible", true],
      ["veh-inactive", false],
    ]);
    // Privacy: the candidate projection never carries registration / raw status / trusted flag.
    const json = JSON.stringify(options);
    for (const forbidden of ["registrationNumber", "OM 99999", "verificationStatus", "objectKey", "claimedFourByFour", "fourByFourVerified"]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("capacity is checked against the booking's seats (a big party excludes a small vehicle)", async () => {
    primeBooking("PENDING_PROVIDER", 7); // vehicle capacity is 6
    serviceFindFirstMock.mockResolvedValue({ id: "svc-1", providerId: PROVIDER, experience: { guidingContent: guidingContent("GUIDE_WITH_TRANSPORT") } });
    poolFindManyMock.mockResolvedValue([poolRow("veh-eligible")]);

    const options = await getBookingAcceptanceVehicleOptions(BOOKING);
    expect(options!.candidates[0]!.eligible).toBe(false);
    expect(options!.candidates[0]!.blockers).toContain("INSUFFICIENT_GUEST_CAPACITY");
  });

  it("BOOKING-INTERVAL-1 — a slot-based transport booking (interval already set) does NOT require a schedule", async () => {
    primeBooking("PENDING_PROVIDER", 4, new Date("2026-06-01T09:00:00.000Z"));
    serviceFindFirstMock.mockResolvedValue({ id: "svc-1", providerId: PROVIDER, experience: { guidingContent: guidingContent("GUIDE_WITH_TRANSPORT") } });
    poolFindManyMock.mockResolvedValue([poolRow("veh-eligible")]);

    const options = await getBookingAcceptanceVehicleOptions(BOOKING);
    expect(options!.vehicleRequired).toBe(true);
    expect(options!.requiresSchedule).toBe(false);
  });

  // --- BOOKING-CONFLICT-1C — proactive busy-state ---------------------------

  it("slot-based booking: an overlapping active reservation marks the candidate busy (one bounded query with candidate ids + interval)", async () => {
    const START = new Date("2026-06-01T09:00:00.000Z");
    primeBooking("PENDING_PROVIDER", 4, START);
    serviceFindFirstMock.mockResolvedValue({ id: "svc-1", providerId: PROVIDER, experience: { guidingContent: guidingContent("GUIDE_WITH_TRANSPORT") } });
    poolFindManyMock.mockResolvedValue([poolRow("veh-free"), poolRow("veh-busy")]);
    findBusyMock.mockResolvedValue(new Set(["veh-busy"]));

    const options = await getBookingAcceptanceVehicleOptions(BOOKING);
    expect(options!.candidates.map((c) => [c.vehicleId, c.eligible, c.busy])).toEqual([
      ["veh-free", true, false],
      ["veh-busy", true, true],
    ]);
    // ONE bounded reservation query for ALL candidate ids over the booking's interval.
    expect(findBusyMock).toHaveBeenCalledTimes(1);
    expect(findBusyMock).toHaveBeenCalledWith(
      expect.anything(),
      ["veh-free", "veh-busy"],
      START,
      new Date(START.getTime() + 3 * 3600_000),
    );
  });

  it("slotless booking (no interval yet): busy-state is NOT computed and every candidate is not busy", async () => {
    primeBooking("PENDING_PROVIDER", 4, null); // no operational interval
    serviceFindFirstMock.mockResolvedValue({ id: "svc-1", providerId: PROVIDER, experience: { guidingContent: guidingContent("GUIDE_WITH_TRANSPORT") } });
    poolFindManyMock.mockResolvedValue([poolRow("veh-eligible")]);

    const options = await getBookingAcceptanceVehicleOptions(BOOKING);
    expect(options!.requiresSchedule).toBe(true);
    expect(options!.candidates[0]!.busy).toBe(false);
    expect(findBusyMock).not.toHaveBeenCalled(); // no window to judge overlap against
  });
});
