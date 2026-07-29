import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

// Phase E.1 (Booking History API, requirement #6) — regression tests
// for GET /api/bookings/[id]/history: confirms the uniform-404 pattern
// (mirroring get-booking-detail.ts) for a nonexistent booking AND for
// one that exists but belongs to neither the requester's Customer nor
// Provider profile, that the owning Customer/Provider/an Admin can all
// read it, and that an invalid UUID never reaches the database at all.
//
// Provider-deactivation gap fix — this route now resolves provider
// identity via the shared resolveProviderStatus() guard
// (src/lib/auth/rbac.ts) instead of a raw, unguarded
// prisma.provider.findUnique() call. Mocked directly here (rather than
// re-testing its internal status classification, which rbac.test.ts's
// own requireProvider() coverage already exercises) so these tests stay
// focused on this route's own new branching: a 403 for an owning
// provider whose account is DEACTIVATED/SUSPENDED, distinct from the
// uniform 404 used everywhere else.

const requireAuthMock = vi.fn();
const findUniqueBookingMock = vi.fn();
const findUniqueCustomerMock = vi.fn();
const resolveProviderStatusMock = vi.fn();
const findUniqueAdminMock = vi.fn();
const getBookingTimelineMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuth: (...args: unknown[]) => requireAuthMock(...args),
  withApiAuth: async (handler: () => Promise<unknown>) => handler(),
  resolveProviderStatus: (...args: unknown[]) => resolveProviderStatusMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    booking: { findUnique: (...args: unknown[]) => findUniqueBookingMock(...args) },
    customer: { findUnique: (...args: unknown[]) => findUniqueCustomerMock(...args) },
    admin: { findUnique: (...args: unknown[]) => findUniqueAdminMock(...args) },
  },
}));

vi.mock("@/lib/booking/lifecycle", () => ({
  getBookingTimeline: (...args: unknown[]) => getBookingTimelineMock(...args),
}));

const { GET } = await import("./route");

const BOOKING_ID = "11111111-1111-1111-1111-111111111111";

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/bookings/[id]/history", () => {
  it("returns 404 for a non-UUID id without querying the database", async () => {
    const response = await GET(new Request("http://localhost"), makeParams("not-a-uuid"));
    expect(response.status).toBe(404);
    expect(findUniqueBookingMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the booking does not exist", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    findUniqueBookingMock.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost"), makeParams(BOOKING_ID));
    expect(response.status).toBe(404);
  });

  it("returns 404 when the booking exists but belongs to neither the requester's customer nor provider profile", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    findUniqueBookingMock.mockResolvedValue({
      id: BOOKING_ID,
      customerId: "someone-elses-customer",
      providerId: "someone-elses-provider",
    });
    findUniqueCustomerMock.mockResolvedValue(null);
    resolveProviderStatusMock.mockResolvedValue({ kind: "not_found" });
    findUniqueAdminMock.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost"), makeParams(BOOKING_ID));
    expect(response.status).toBe(404);
    expect(getBookingTimelineMock).not.toHaveBeenCalled();
  });

  it("returns the timeline for the owning customer", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    findUniqueBookingMock.mockResolvedValue({
      id: BOOKING_ID,
      customerId: "customer-1",
      providerId: "provider-1",
    });
    findUniqueCustomerMock.mockResolvedValue({ id: "customer-1" });
    resolveProviderStatusMock.mockResolvedValue({ kind: "not_found" });
    findUniqueAdminMock.mockResolvedValue(null);
    getBookingTimelineMock.mockResolvedValue([{ id: "event-1", toStatus: "CREATED" }]);

    const response = await GET(new Request("http://localhost"), makeParams(BOOKING_ID));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bookingId).toBe(BOOKING_ID);
    expect(body.timeline).toEqual([{ id: "event-1", toStatus: "CREATED" }]);
  });

  it("returns the timeline for an admin who does not own the booking", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "admin-user-1" } });
    findUniqueBookingMock.mockResolvedValue({
      id: BOOKING_ID,
      customerId: "customer-1",
      providerId: "provider-1",
    });
    findUniqueCustomerMock.mockResolvedValue(null);
    resolveProviderStatusMock.mockResolvedValue({ kind: "not_found" });
    findUniqueAdminMock.mockResolvedValue({ id: "admin-1" });
    getBookingTimelineMock.mockResolvedValue([]);

    const response = await GET(new Request("http://localhost"), makeParams(BOOKING_ID));
    expect(response.status).toBe(200);
  });

  describe("provider-deactivation gap fix", () => {
    it("returns the timeline for the owning provider whose account is APPROVED (active)", async () => {
      requireAuthMock.mockResolvedValue({ barqUser: { id: "provider-user-1" } });
      findUniqueBookingMock.mockResolvedValue({
        id: BOOKING_ID,
        customerId: "customer-1",
        providerId: "provider-1",
      });
      findUniqueCustomerMock.mockResolvedValue(null);
      resolveProviderStatusMock.mockResolvedValue({
        kind: "active",
        provider: { id: "provider-1", status: "APPROVED" },
      });
      findUniqueAdminMock.mockResolvedValue(null);
      getBookingTimelineMock.mockResolvedValue([{ id: "event-1", toStatus: "CONFIRMED" }]);

      const response = await GET(new Request("http://localhost"), makeParams(BOOKING_ID));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.bookingId).toBe(BOOKING_ID);
    });

    it("returns 403 Forbidden for the owning provider whose account is DEACTIVATED", async () => {
      requireAuthMock.mockResolvedValue({ barqUser: { id: "provider-user-1" } });
      findUniqueBookingMock.mockResolvedValue({
        id: BOOKING_ID,
        customerId: "customer-1",
        providerId: "provider-1",
      });
      findUniqueCustomerMock.mockResolvedValue(null);
      resolveProviderStatusMock.mockResolvedValue({
        kind: "inactive",
        provider: { id: "provider-1", status: "DEACTIVATED" },
      });
      findUniqueAdminMock.mockResolvedValue(null);

      const response = await GET(new Request("http://localhost"), makeParams(BOOKING_ID));
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe("Forbidden");
      expect(getBookingTimelineMock).not.toHaveBeenCalled();
    });

    it("returns 403 Forbidden for the owning provider whose account is SUSPENDED", async () => {
      requireAuthMock.mockResolvedValue({ barqUser: { id: "provider-user-1" } });
      findUniqueBookingMock.mockResolvedValue({
        id: BOOKING_ID,
        customerId: "customer-1",
        providerId: "provider-1",
      });
      findUniqueCustomerMock.mockResolvedValue(null);
      resolveProviderStatusMock.mockResolvedValue({
        kind: "inactive",
        provider: { id: "provider-1", status: "SUSPENDED" },
      });
      findUniqueAdminMock.mockResolvedValue(null);

      const response = await GET(new Request("http://localhost"), makeParams(BOOKING_ID));
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe("Forbidden");
      expect(getBookingTimelineMock).not.toHaveBeenCalled();
    });

    it("returns 404 (not 403) for a DEACTIVATED provider who does not own this booking — unauthorized users still get the uniform not-found", async () => {
      requireAuthMock.mockResolvedValue({ barqUser: { id: "provider-user-1" } });
      findUniqueBookingMock.mockResolvedValue({
        id: BOOKING_ID,
        customerId: "customer-1",
        providerId: "someone-elses-provider",
      });
      findUniqueCustomerMock.mockResolvedValue(null);
      resolveProviderStatusMock.mockResolvedValue({
        kind: "inactive",
        provider: { id: "provider-1", status: "DEACTIVATED" },
      });
      findUniqueAdminMock.mockResolvedValue(null);

      const response = await GET(new Request("http://localhost"), makeParams(BOOKING_ID));

      expect(response.status).toBe(404);
      expect(getBookingTimelineMock).not.toHaveBeenCalled();
    });
  });
});
