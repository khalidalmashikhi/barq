import { describe, it, expect, vi, afterEach } from "vitest";

// Admin Backoffice Hardening (Gate A) — getMyBookings() is an API-reachable
// customer read (GET /api/v1/me/bookings) that uses requireAuth() + a raw Customer
// query rather than requireCustomer(), so it must enforce the backoffice-only
// exclusion explicitly. These tests prove: an ACTIVE admin is denied (ForbiddenError,
// before the Customer row is ever read, so the /api/v1 wrapper maps it to 403), while
// a normal user's honest-empty-state path is unchanged.

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

const customerFindUniqueMock = vi.fn();
const bookingFindManyMock = vi.fn();
const bookingCountMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    customer: { findUnique: (...a: unknown[]) => customerFindUniqueMock(...a) },
    booking: {
      findMany: (...a: unknown[]) => bookingFindManyMock(...a),
      count: (...a: unknown[]) => bookingCountMock(...a),
    },
  },
}));

const { getMyBookings } = await import("./get-my-bookings");

afterEach(() => {
  requireAuthMock.mockReset();
  assertNotActiveAdminMock.mockReset();
  customerFindUniqueMock.mockReset();
  bookingFindManyMock.mockReset();
  bookingCountMock.mockReset();
});

describe("getMyBookings (Gate A — active admin excluded)", () => {
  it("throws ForbiddenError for an ACTIVE admin, before any Customer lookup", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "admin-user" } });
    assertNotActiveAdminMock.mockRejectedValue(new ForbiddenError("Admin accounts are backoffice-only", "ADMIN_BACKOFFICE_ONLY"));

    const error = await getMyBookings().catch((e) => e);

    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as ForbiddenError).code).toBe("ADMIN_BACKOFFICE_ONLY");
    expect(customerFindUniqueMock).not.toHaveBeenCalled();
  });

  it("still returns an honest empty list for a normal user with no Customer row", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    assertNotActiveAdminMock.mockResolvedValue(undefined);
    customerFindUniqueMock.mockResolvedValue(null);

    const result = await getMyBookings();

    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(bookingFindManyMock).not.toHaveBeenCalled();
  });
});
