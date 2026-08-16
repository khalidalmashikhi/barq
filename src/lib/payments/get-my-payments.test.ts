import { describe, it, expect, vi, afterEach } from "vitest";

// Payment Experience & Financial Operations phase — regression tests
// for getMyPayments(). Confirms: honest empty list for a user with no
// Customer profile (mirrors get-my-bookings.ts's own reasoning),
// ownership scoping via booking.customerId, status filtering, and that
// providerReference is never selected/returned.

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
  requireAuth: (...args: unknown[]) => requireAuthMock(...args),
  assertNotActiveAdmin: (...args: unknown[]) => assertNotActiveAdminMock(...args),
  ForbiddenError,
}));

const getLocaleMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getLocale: () => getLocaleMock(),
}));

const findUniqueCustomerMock = vi.fn();
const countMock = vi.fn();
const findManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    customer: {
      findUnique: (...args: unknown[]) => findUniqueCustomerMock(...args),
    },
    payment: {
      count: (...args: unknown[]) => countMock(...args),
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}));

const { getMyPayments } = await import("./get-my-payments");

afterEach(() => {
  requireAuthMock.mockReset();
  assertNotActiveAdminMock.mockReset();
  getLocaleMock.mockReset();
  findUniqueCustomerMock.mockReset();
  countMock.mockReset();
  findManyMock.mockReset();
});

describe("getMyPayments", () => {
  it("Gate A: denies an ACTIVE admin at the domain layer, before any Customer/Payment read", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "admin-user" } });
    assertNotActiveAdminMock.mockRejectedValue(new ForbiddenError("Admin accounts are backoffice-only", "ADMIN_BACKOFFICE_ONLY"));

    const error = await getMyPayments().catch((e) => e);

    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as ForbiddenError).code).toBe("ADMIN_BACKOFFICE_ONLY");
    expect(findUniqueCustomerMock).not.toHaveBeenCalled();
  });

  it("returns an honest empty list when the authenticated user has no Customer profile", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    findUniqueCustomerMock.mockResolvedValue(null);

    const result = await getMyPayments();

    expect(result).toEqual({ items: [], totalCount: 0, page: 1, pageSize: 10, totalPages: 1 });
    expect(countMock).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("scopes every query through booking.customerId — never a separate ownership check", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    findUniqueCustomerMock.mockResolvedValue({ id: "customer-1" });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getMyPayments();

    expect(countMock).toHaveBeenCalledWith({ where: { booking: { customerId: "customer-1" } } });
  });

  it("applies an optional status filter", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    findUniqueCustomerMock.mockResolvedValue({ id: "customer-1" });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getMyPayments({ status: "CAPTURED" });

    expect(countMock).toHaveBeenCalledWith({ where: { booking: { customerId: "customer-1" }, status: "CAPTURED" } });
  });

  it("maps rows to the list shape and never includes providerReference", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    findUniqueCustomerMock.mockResolvedValue({ id: "customer-1" });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([
      {
        id: "payment-1",
        bookingId: "booking-1",
        amount: "25.00",
        currency: "OMR",
        status: "CAPTURED",
        refundAmount: null,
        capturedAt: new Date("2026-07-20T00:00:00Z"),
        createdAt: new Date("2026-07-19T00:00:00Z"),
        booking: {
          service: { name: { ar: "جولة", en: "Desert Tour" } },
          provider: { businessName: { ar: "مزود", en: "Desert Co" } },
        },
        invoice: { id: "invoice-1" },
        providerReference: "pi_should_never_leak",
      },
    ]);

    const result = await getMyPayments();

    expect(result.items).toEqual([
      expect.objectContaining({
        id: "payment-1",
        bookingId: "booking-1",
        serviceName: "Desert Tour",
        providerName: "Desert Co",
        amount: "25.00",
        currency: "OMR",
        status: "CAPTURED",
        refundAmount: null,
        hasInvoice: true,
      }),
    ]);
    expect(result.items[0]).not.toHaveProperty("providerReference");
  });
});
