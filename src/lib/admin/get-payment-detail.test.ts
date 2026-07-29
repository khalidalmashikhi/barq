import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.12 (Payment Foundation) — regression test for
// getPaymentDetail(), mirroring get-booking-detail.test.ts's (admin) shape.

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const getLocaleMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getLocale: () => getLocaleMock(),
}));

const findUniqueMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    payment: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

const { getPaymentDetail } = await import("./get-payment-detail");

const PAYMENT_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  getLocaleMock.mockReset();
  findUniqueMock.mockReset();
});

describe("getPaymentDetail", () => {
  it("returns null for a malformed paymentId without checking admin status", async () => {
    const result = await getPaymentDetail("not-a-uuid");

    expect(result).toBeNull();
  });

  it("requires an Admin and returns null when the payment doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);

    const result = await getPaymentDetail(PAYMENT_ID);

    expect(requireAdminMock).toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("returns full detail joined through the linked Booking", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    findUniqueMock.mockResolvedValue({
      id: PAYMENT_ID,
      bookingId: "booking-1",
      amount: "15.00",
      currency: "OMR",
      status: "INITIATED",
      refundAmount: null,
      providerReference: null,
      capturedAt: null,
      createdAt: new Date("2026-07-24T00:00:00Z"),
      updatedAt: new Date("2026-07-24T00:00:00Z"),
      booking: {
        customerId: "customer-1",
        providerId: "provider-1",
        serviceId: "service-1",
        service: { name: { ar: "جولة", en: "Desert Tour" } },
        provider: { businessName: { ar: "مزود", en: "Desert Co" } },
      },
      invoice: null,
    });

    const result = await getPaymentDetail(PAYMENT_ID);

    expect(result).toEqual(
      expect.objectContaining({
        id: PAYMENT_ID,
        bookingId: "booking-1",
        customerId: "customer-1",
        providerId: "provider-1",
        serviceId: "service-1",
        serviceName: "Desert Tour",
        providerName: "Desert Co",
        amount: "15.00",
        currency: "OMR",
        status: "INITIATED",
        refundAmount: null,
        providerReference: null,
        invoice: null,
      })
    );
  });

  // Payment Experience & Financial Operations phase additions.
  it("surfaces the linked Invoice (bilingual content resolved to the caller's locale) when one exists", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    findUniqueMock.mockResolvedValue({
      id: PAYMENT_ID,
      bookingId: "booking-1",
      amount: "15.00",
      currency: "OMR",
      status: "CAPTURED",
      refundAmount: null,
      providerReference: "pi_stripe_abc123",
      capturedAt: new Date("2026-07-25T00:00:00Z"),
      createdAt: new Date("2026-07-24T00:00:00Z"),
      updatedAt: new Date("2026-07-25T00:00:00Z"),
      booking: {
        customerId: "customer-1",
        providerId: "provider-1",
        serviceId: "service-1",
        service: { name: { ar: "جولة", en: "Desert Tour" } },
        provider: { businessName: { ar: "مزود", en: "Desert Co" } },
      },
      invoice: {
        id: "invoice-1",
        invoiceNumber: "BARQ-2026-000123",
        status: "GENERATED",
        issuedAt: new Date("2026-07-25T00:00:00Z"),
        content: { ar: "فاتورة", en: "Invoice for booking" },
      },
    });

    const result = await getPaymentDetail(PAYMENT_ID);

    expect(result).toEqual(
      expect.objectContaining({
        providerReference: "pi_stripe_abc123",
        invoice: expect.objectContaining({
          id: "invoice-1",
          invoiceNumber: "BARQ-2026-000123",
          status: "GENERATED",
          content: "Invoice for booking",
        }),
      })
    );
  });
});
