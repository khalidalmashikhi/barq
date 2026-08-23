import { describe, it, expect, vi, afterEach } from "vitest";

// Admin Backoffice Hardening (Gate A) — getBookingDetail() is an API-reachable
// customer read (GET /api/v1/me/bookings/[id] and its timeline) that uses
// requireAuth() + a raw Customer query rather than requireCustomer(), so it enforces
// the backoffice-only exclusion explicitly. An ACTIVE admin is denied with a
// ForbiddenError (which the /api/v1 wrapper maps to 403), while a normal owner's
// path is unchanged.

vi.mock("server-only", () => ({}));

const requireAuthMock = vi.fn();
const assertNotActiveAdminMock = vi.fn();

class ForbiddenError extends Error {
  code?: string;
  constructor(message?: string, code?: string) {
    super(message);
    this.code = code;
  }
}

vi.mock("@/lib/auth", () => ({
  requireAuth: (...a: unknown[]) => requireAuthMock(...a),
  assertNotActiveAdmin: (...a: unknown[]) => assertNotActiveAdminMock(...a),
}));

vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("en") }));
vi.mock("@/lib/i18n/extract-localized-text", () => ({ extractLocalizedText: (v: unknown) => String(v) }));
vi.mock("@/lib/uuid", () => ({ isValidUuid: () => true }));

const customerFindUniqueMock = vi.fn();
const bookingFindFirstMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    customer: { findUnique: (...a: unknown[]) => customerFindUniqueMock(...a) },
    booking: { findFirst: (...a: unknown[]) => bookingFindFirstMock(...a) },
  },
}));

const { getBookingDetail } = await import("./get-booking-detail");

const VALID_UUID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAuthMock.mockReset();
  assertNotActiveAdminMock.mockReset();
  customerFindUniqueMock.mockReset();
  bookingFindFirstMock.mockReset();
});

describe("getBookingDetail (Gate A — active admin excluded)", () => {
  it("throws ForbiddenError for an ACTIVE admin, before any Customer/Booking lookup", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "admin-user" } });
    assertNotActiveAdminMock.mockRejectedValue(new ForbiddenError("Admin accounts are backoffice-only", "ADMIN_BACKOFFICE_ONLY"));

    const error = await getBookingDetail(VALID_UUID).catch((e) => e);

    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as ForbiddenError).code).toBe("ADMIN_BACKOFFICE_ONLY");
    expect(customerFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns null (unchanged) for a normal user with no Customer row", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    assertNotActiveAdminMock.mockResolvedValue(undefined);
    customerFindUniqueMock.mockResolvedValue(null);

    const result = await getBookingDetail(VALID_UUID);

    expect(result).toBeNull();
    expect(bookingFindFirstMock).not.toHaveBeenCalled();
  });
});

describe("getBookingDetail — BOOKING-VEHICLE-2 assignedVehicle (snapshot authority)", () => {
  const SNAP = { make: "Toyota", model: "Prado", modelYear: 2024, color: "White", passengerCapacity: 6, vehicleType: "SUV", isFourByFour: false };

  function primeBooking(vehicleSnapshot: unknown) {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    assertNotActiveAdminMock.mockResolvedValue(undefined);
    customerFindUniqueMock.mockResolvedValue({ id: "cust-1" });
    bookingFindFirstMock.mockResolvedValue({
      id: VALID_UUID, serviceId: "s1", providerId: "p1", status: "CONFIRMED", seats: 4,
      priceSnapshotAmount: null, priceSnapshotCurrency: null, confirmedAt: null,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      vehicleSnapshot,
      service: { name: "Safari" }, provider: { businessName: "Desert Co" },
      availability: null, review: null, payment: null,
    });
  }

  it("parses a valid snapshot into the customer-safe assignedVehicle", async () => {
    primeBooking({ ...SNAP });
    const result = await getBookingDetail(VALID_UUID);
    expect(result?.assignedVehicle).toEqual(SNAP);
  });

  it("null snapshot → assignedVehicle null (no live fallback)", async () => {
    primeBooking(null);
    expect((await getBookingDetail(VALID_UUID))?.assignedVehicle).toBeNull();
  });

  it("malformed / private-key-bearing snapshot → fail closed to null", async () => {
    primeBooking({ ...SNAP, registrationNumber: "OM 12345" }); // extra private key → strict parser rejects
    const result = await getBookingDetail(VALID_UUID);
    expect(result?.assignedVehicle).toBeNull();
    expect(JSON.stringify(result)).not.toContain("OM 12345");
  });

  it("a later live Vehicle change cannot alter the historical snapshot the reader returns", async () => {
    // The reader derives ONLY from vehicleSnapshot; there is no Vehicle join for the customer,
    // so whatever the live Vehicle later becomes, the returned facts are the snapshot's.
    primeBooking({ ...SNAP, make: "Toyota", model: "Prado" });
    const result = await getBookingDetail(VALID_UUID);
    expect(result?.assignedVehicle).toEqual(SNAP);
    // No id/plate ever present.
    const s = JSON.stringify(result);
    for (const forbidden of ["vehicleId", "assetId", "registrationNumber"]) expect(s).not.toContain(forbidden);
  });
});
