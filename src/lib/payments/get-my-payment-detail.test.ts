import { describe, it, expect, vi, afterEach } from "vitest";

// Payment Experience & Financial Operations phase — regression tests
// for getMyPaymentDetail(). Confirms the uniform-404 ownership
// convention (malformed id, missing Payment, and another customer's
// Payment all return null identically), the honest Invoice-absent
// state, and that providerReference is never returned.

vi.mock("server-only", () => ({}));

const requireAuthMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuth: (...args: unknown[]) => requireAuthMock(...args),
}));

const getLocaleMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getLocale: () => getLocaleMock(),
}));

const findUniqueCustomerMock = vi.fn();
const findFirstMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    customer: {
      findUnique: (...args: unknown[]) => findUniqueCustomerMock(...args),
    },
    payment: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
  },
}));

const { getMyPaymentDetail } = await import("./get-my-payment-detail");

const PAYMENT_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAuthMock.mockReset();
  getLocaleMock.mockReset();
  findUniqueCustomerMock.mockReset();
  findFirstMock.mockReset();
});

describe("getMyPaymentDetail", () => {
  it("returns null for a malformed paymentId without checking auth", async () => {
    const result = await getMyPaymentDetail("not-a-uuid");

    expect(result).toBeNull();
    expect(requireAuthMock).not.toHaveBeenCalled();
  });

  it("returns null when the authenticated user has no Customer profile", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    findUniqueCustomerMock.mockResolvedValue(null);

    const result = await getMyPaymentDetail(PAYMENT_ID);

    expect(result).toBeNull();
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it("scopes the query through booking.customerId — a missing Payment and another customer's Payment both return null identically", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    findUniqueCustomerMock.mockResolvedValue({ id: "customer-1" });
    findFirstMock.mockResolvedValue(null);

    const result = await getMyPaymentDetail(PAYMENT_ID);

    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: PAYMENT_ID, booking: { customerId: "customer-1" } } })
    );
    expect(result).toBeNull();
  });

  it("returns an honest null invoice when no Invoice exists for this booking", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    findUniqueCustomerMock.mockResolvedValue({ id: "customer-1" });
    getLocaleMock.mockResolvedValue("en");
    findFirstMock.mockResolvedValue({
      id: PAYMENT_ID,
      bookingId: "booking-1",
      amount: "25.00",
      currency: "OMR",
      status: "INITIATED",
      refundAmount: null,
      capturedAt: null,
      createdAt: new Date("2026-07-19T00:00:00Z"),
      booking: {
        service: { name: { ar: "جولة", en: "Desert Tour" } },
        provider: { businessName: { ar: "مزود", en: "Desert Co" } },
      },
      invoice: null,
    });

    const result = await getMyPaymentDetail(PAYMENT_ID);

    expect(result).toEqual(expect.objectContaining({ invoice: null }));
    expect(result).not.toHaveProperty("providerReference");
  });

  it("resolves the Invoice's stored bilingual content to the caller's locale when one exists", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    findUniqueCustomerMock.mockResolvedValue({ id: "customer-1" });
    getLocaleMock.mockResolvedValue("en");
    findFirstMock.mockResolvedValue({
      id: PAYMENT_ID,
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
      invoice: {
        id: "invoice-1",
        invoiceNumber: "BARQ-2026-000123",
        status: "GENERATED",
        issuedAt: new Date("2026-07-20T00:00:00Z"),
        content: { ar: "فاتورة الحجز", en: "Invoice for booking" },
      },
    });

    const result = await getMyPaymentDetail(PAYMENT_ID);

    expect(result).toEqual(
      expect.objectContaining({
        invoice: expect.objectContaining({
          invoiceNumber: "BARQ-2026-000123",
          status: "GENERATED",
          content: "Invoice for booking",
        }),
      })
    );
  });
});
