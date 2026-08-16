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
