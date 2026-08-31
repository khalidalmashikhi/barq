import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.9 (Booking Foundation) — regression test for
// getBookingDetail() (admin), mirroring get-service-detail.test.ts's
// shape. Unlike the customer-facing get-booking-detail.ts, this must
// return a Booking regardless of who it belongs to — no ownership
// filter is ever applied.

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
    booking: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

const { getBookingDetail } = await import("./get-booking-detail");

const BOOKING_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  getLocaleMock.mockReset();
  findUniqueMock.mockReset();
});

describe("getBookingDetail (admin)", () => {
  it("returns null for a malformed bookingId without checking admin status", async () => {
    const result = await getBookingDetail("not-a-uuid");

    expect(result).toBeNull();
  });

  it("requires an Admin and returns null when the booking doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);

    const result = await getBookingDetail(BOOKING_ID);

    expect(requireAdminMock).toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("returns full detail for any booking, with no ownership restriction", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    findUniqueMock.mockResolvedValue({
      id: BOOKING_ID,
      customerId: "customer-1",
      serviceId: "service-1",
      providerId: "provider-1",
      status: "CONFIRMED",
      seats: 2,
      availabilityId: "availability-1",
      priceSnapshotAmount: "25.00",
      priceSnapshotCurrency: "OMR",
      commissionSnapshotAmount: "2.50",
      commissionSnapshotTier: "TIER_10",
      confirmedAt: new Date("2026-07-20T00:00:00Z"),
      createdAt: new Date("2026-07-19T00:00:00Z"),
      updatedAt: new Date("2026-07-20T00:00:00Z"),
      service: { name: { ar: "جولة", en: "Desert Tour" } },
      provider: { businessName: { ar: "مزود", en: "Desert Co" } },
      availability: { startTime: new Date("2026-08-01T10:00:00Z"), endTime: new Date("2026-08-01T13:00:00Z") },
      review: null,
      payment: null,
    });

    const result = await getBookingDetail(BOOKING_ID);

    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { id: BOOKING_ID },
      include: {
        service: true,
        provider: true,
        availability: true,
        review: { select: { id: true } },
        payment: { select: { id: true } },
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: BOOKING_ID,
        customerId: "customer-1",
        serviceName: "Desert Tour",
        providerName: "Desert Co",
        status: "CONFIRMED",
        seats: 2,
        priceSnapshot: "25.00 OMR",
        commissionSnapshot: { amount: "2.50", tier: "TIER_10" },
        reviewId: null,
        paymentId: null,
      })
    );
  });

  it("exposes reviewId when a Review exists for this booking (Admin Operations Platform addition)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    findUniqueMock.mockResolvedValue({
      id: BOOKING_ID,
      customerId: "customer-1",
      serviceId: "service-1",
      providerId: "provider-1",
      status: "COMPLETED",
      seats: 1,
      availabilityId: null,
      priceSnapshotAmount: "25.00",
      priceSnapshotCurrency: "OMR",
      commissionSnapshotAmount: null,
      commissionSnapshotTier: null,
      confirmedAt: new Date("2026-07-20T00:00:00Z"),
      createdAt: new Date("2026-07-19T00:00:00Z"),
      updatedAt: new Date("2026-07-25T00:00:00Z"),
      service: { name: { ar: "جولة", en: "Desert Tour" } },
      provider: { businessName: { ar: "مزود", en: "Desert Co" } },
      availability: null,
      review: { id: "review-1" },
      payment: { id: "payment-1" },
    });

    const result = await getBookingDetail(BOOKING_ID);

    expect(result).toEqual(expect.objectContaining({ reviewId: "review-1", paymentId: "payment-1" }));
  });

  // BOOKING OPS OBSERVABILITY — admin sees the provider's fulfillment instructions (both languages),
  // fail-closed to null when absent/malformed.
  it("exposes fulfillmentInstructions (both languages) when present", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    findUniqueMock.mockResolvedValue({
      id: BOOKING_ID, customerId: "customer-1", serviceId: "service-1", providerId: "provider-1",
      status: "CONFIRMED", seats: 1, availabilityId: null,
      priceSnapshotAmount: "25.00", priceSnapshotCurrency: "OMR", commissionSnapshotAmount: null, commissionSnapshotTier: null,
      confirmedAt: null, createdAt: new Date("2026-07-19T00:00:00Z"), updatedAt: new Date("2026-07-25T00:00:00Z"),
      fulfillmentInstructions: { ar: "استلام من الردهة", en: "Pickup at the lobby" },
      service: { name: { en: "Desert Tour" } }, provider: { businessName: { en: "Desert Co" } },
      availability: null, review: null, payment: null,
    });

    const result = await getBookingDetail(BOOKING_ID);
    expect(result?.fulfillmentInstructions).toEqual({ ar: "استلام من الردهة", en: "Pickup at the lobby" });
  });

  it("fulfillmentInstructions is null when the booking has none (honest empty state)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    findUniqueMock.mockResolvedValue({
      id: BOOKING_ID, customerId: "customer-1", serviceId: "service-1", providerId: "provider-1",
      status: "CONFIRMED", seats: 1, availabilityId: null,
      priceSnapshotAmount: null, priceSnapshotCurrency: null, commissionSnapshotAmount: null, commissionSnapshotTier: null,
      confirmedAt: null, createdAt: new Date("2026-07-19T00:00:00Z"), updatedAt: new Date("2026-07-25T00:00:00Z"),
      fulfillmentInstructions: null,
      service: { name: { en: "X" } }, provider: { businessName: { en: "Y" } },
      availability: null, review: null, payment: null,
    });

    expect((await getBookingDetail(BOOKING_ID))?.fulfillmentInstructions).toBeNull();
  });
});
