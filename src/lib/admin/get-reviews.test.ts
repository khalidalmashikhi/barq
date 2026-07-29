import { describe, it, expect, vi, afterEach } from "vitest";

// Admin Operations Platform — regression tests for getReviews(). This
// module exports exactly one function — no flag/publish/remove action
// exists here, confirmed structurally by only mocking read methods
// (findMany/count) and never a write method on prisma.review.

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
    review: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
    },
  },
}));

const { getReviews } = await import("./get-reviews");

function reviewRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "review-1",
    bookingId: "booking-1",
    customerId: "customer-1",
    providerId: "provider-1",
    content: "Great trip",
    moderationState: "PUBLISHED",
    createdAt: new Date(),
    rating: { value: 5 },
    customer: { user: { phoneNumber: "+96890000001" } },
    provider: { businessName: { en: "Trips Co" } },
    booking: { service: { name: { en: "Desert Safari" } } },
    ...overrides,
  };
}

afterEach(() => {
  requireAdminMock.mockReset();
  getLocaleMock.mockReset();
  findManyMock.mockReset();
  countMock.mockReset();
});

describe("getReviews", () => {
  it("requires an Admin", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getReviews();

    expect(requireAdminMock).toHaveBeenCalled();
  });

  it("is read-only against real data — every returned field is derived from the query, nothing mutated", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([reviewRow()]);

    const result = await getReviews();

    expect(result.items).toEqual([
      expect.objectContaining({
        id: "review-1",
        rating: 5,
        content: "Great trip",
        moderationState: "PUBLISHED",
        customerPhoneNumber: "+96890000001",
        providerName: "Trips Co",
        serviceName: "Desert Safari",
      }),
    ]);
  });

  it("filters by moderationState when provided, and is unscoped (shows every state) by default", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getReviews({ moderationState: "FLAGGED" });
    expect(countMock).toHaveBeenLastCalledWith({ where: { moderationState: "FLAGGED" } });

    await getReviews();
    expect(countMock).toHaveBeenLastCalledWith({ where: {} });
  });

  it("filters by providerId when provided", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getReviews({ providerId: "019f4e4e-8112-71d3-bf57-b38c0b66e1bf" });

    expect(countMock).toHaveBeenCalledWith({ where: { providerId: "019f4e4e-8112-71d3-bf57-b38c0b66e1bf" } });
  });

  it("filters by rating via the Rating relation", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getReviews({ rating: 4 });

    expect(countMock).toHaveBeenCalledWith({ where: { rating: { value: 4 } } });
  });

  it("returns an empty result for a malformed providerId without querying the database", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");

    const result = await getReviews({ providerId: "not-a-uuid" });

    expect(result).toEqual({ items: [], totalCount: 0, page: 1, pageSize: 20, totalPages: 1 });
    expect(countMock).not.toHaveBeenCalled();
  });

  it("computes pagination fields correctly", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(45);
    findManyMock.mockResolvedValue([]);

    const result = await getReviews({ page: 2, pageSize: 20 });

    expect(result.page).toBe(2);
    expect(result.totalPages).toBe(3);
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 20 }));
  });
});
