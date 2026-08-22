import { describe, it, expect, vi, afterEach } from "vitest";

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
});

function primeBooking(status = "PENDING_PROVIDER", seats = 4) {
  requireProviderMock.mockResolvedValue({ provider: { id: PROVIDER } });
  bookingFindFirstMock.mockResolvedValue({ id: BOOKING, serviceId: "svc-1", seats, status });
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
});
