import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.12 (Payment Foundation) — regression test for getPayments(),
// mirroring get-bookings.test.ts's shape.

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const getLocaleMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getLocale: () => getLocaleMock(),
}));

const findManyMock = vi.fn();
const countMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    payment: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
    },
  },
}));

const { getPayments } = await import("./get-payments");

afterEach(() => {
  requireAdminMock.mockReset();
  getLocaleMock.mockReset();
  findManyMock.mockReset();
  countMock.mockReset();
});

describe("getPayments", () => {
  it("requires an Admin and returns a paginated result", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([
      {
        id: "payment-1",
        bookingId: "booking-1",
        amount: "15.00",
        currency: "OMR",
        status: "INITIATED",
        capturedAt: null,
        createdAt: new Date(),
        booking: { service: { name: { ar: "جولة", en: "Desert Tour" } }, provider: { businessName: { ar: "مزود", en: "Desert Co" } } },
      },
    ]);

    const result = await getPayments();

    expect(requireAdminMock).toHaveBeenCalled();
    expect(result.totalCount).toBe(1);
    expect(result.page).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        id: "payment-1",
        bookingId: "booking-1",
        serviceName: "Desert Tour",
        providerName: "Desert Co",
        amount: "15.00",
        currency: "OMR",
        status: "INITIATED",
      }),
    ]);
  });

  it("filters by status and bookingId when provided", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getPayments({ status: "CAPTURED", bookingId: "019f4e4e-8116-7052-b15e-b79b5ccb1af9" });

    expect(countMock).toHaveBeenCalledWith({
      where: { bookingId: "019f4e4e-8116-7052-b15e-b79b5ccb1af9", status: "CAPTURED" },
    });
  });

  it("short-circuits to an empty result for a malformed bookingId, never calling Prisma", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");

    const result = await getPayments({ bookingId: "not-a-uuid" });

    expect(result).toEqual({ items: [], totalCount: 0, page: 1, pageSize: 20, totalPages: 1 });
    expect(countMock).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
  });
});
