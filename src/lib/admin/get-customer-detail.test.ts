import { describe, it, expect, vi, afterEach } from "vitest";

// User & Access Management (Batch 6) — regression test for getCustomerDetail()'s
// Batch-6 additions: userId surfacing and customer-scoped payment linkage via
// the existing Payment -> Booking -> customerId relation (no schema change).

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAdmin: (...a: unknown[]) => requireAdminMock(...a) }));
vi.mock("next-intl/server", () => ({ getLocale: () => Promise.resolve("en") }));
vi.mock("@/lib/i18n/extract-localized-text", () => ({ extractLocalizedText: (v: unknown) => (typeof v === "string" ? v : "Experience") }));

const customerFindUniqueMock = vi.fn();
const bookingFindManyMock = vi.fn();
const reviewFindManyMock = vi.fn();
const paymentFindManyMock = vi.fn();
const paymentCountMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    customer: { findUnique: (...a: unknown[]) => customerFindUniqueMock(...a) },
    booking: { findMany: (...a: unknown[]) => bookingFindManyMock(...a) },
    review: { findMany: (...a: unknown[]) => reviewFindManyMock(...a) },
    payment: { findMany: (...a: unknown[]) => paymentFindManyMock(...a), count: (...a: unknown[]) => paymentCountMock(...a) },
  },
}));

const { getCustomerDetail } = await import("./get-customer-detail");
const ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  customerFindUniqueMock.mockReset();
  bookingFindManyMock.mockReset();
  reviewFindManyMock.mockReset();
  paymentFindManyMock.mockReset();
  paymentCountMock.mockReset();
});

describe("getCustomerDetail — payment linkage (Batch 6)", () => {
  it("denies a non-admin caller", async () => {
    requireAdminMock.mockRejectedValue(new Error("Admin role required"));
    await expect(getCustomerDetail(ID)).rejects.toThrow(/Admin role required/);
  });

  it("surfaces userId and customer-scoped payments via booking.customerId", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    customerFindUniqueMock.mockResolvedValue({ id: ID, userId: "user-1", createdAt: new Date(), user: { phoneNumber: "+96890000001" }, _count: { bookings: 2, reviews: 1 } });
    bookingFindManyMock.mockResolvedValue([]);
    reviewFindManyMock.mockResolvedValue([]);
    paymentFindManyMock.mockResolvedValue([
      { id: "pay-1", amount: { toString: () => "100.00" }, currency: "OMR", status: "CAPTURED", createdAt: new Date(), booking: { service: { name: "City Tour" } } },
    ]);
    paymentCountMock.mockResolvedValue(3);

    const result = await getCustomerDetail(ID);

    expect(paymentFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { booking: { customerId: ID } } }));
    expect(paymentCountMock).toHaveBeenCalledWith({ where: { booking: { customerId: ID } } });
    expect(result?.userId).toBe("user-1");
    expect(result?.paymentCount).toBe(3);
    expect(result?.recentPayments[0]).toEqual(expect.objectContaining({ amount: "100.00", currency: "OMR", status: "CAPTURED" }));
  });
});
