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

// BOOKING-SUMMARY-RECONCILIATION — the two machine ids the list must carry, and the
// query discipline that must NOT change to carry them.
describe("getMyBookings — reconciliation identifiers", () => {
  function row(over: Record<string, unknown> = {}) {
    return {
      id: "b1",
      serviceId: "svc-1",
      availabilityId: "av-1",
      status: "PENDING_PROVIDER",
      priceSnapshotAmount: "25",
      priceSnapshotCurrency: "OMR",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      service: { name: "Desert Safari" },
      availability: { startTime: new Date("2026-06-01T09:00:00.000Z") },
      ...over,
    };
  }

  function arrange(rows: Record<string, unknown>[]) {
    requireAuthMock.mockResolvedValue({ authUserId: "au1", barqUser: { id: "u1" } });
    customerFindUniqueMock.mockResolvedValue({ id: "c1" });
    bookingCountMock.mockResolvedValue(rows.length);
    bookingFindManyMock.mockResolvedValue(rows);
  }

  it("carries the booking's exact serviceId and availabilityId", async () => {
    arrange([row()]);

    const result = await getMyBookings();

    expect(result.items[0]!.serviceId).toBe("svc-1");
    expect(result.items[0]!.availabilityId).toBe("av-1");
  });

  /**
   * NULL, NEVER "". A genuinely slotless booking has no slot; an empty string would be
   * a value a client could accidentally match a candidate against.
   */
  it("reports availabilityId as null for a slotless booking", async () => {
    arrange([row({ availabilityId: null, availability: null })]);

    const result = await getMyBookings();

    expect(result.items[0]!.availabilityId).toBeNull();
    expect(result.items[0]!.slotStartTime).toBeNull();
    expect(result.items[0]!.serviceId).toBe("svc-1");
  });

  /**
   * READ FROM THE BOOKING SCALAR, not from the joined relation. They are the same value,
   * but the scalar is the one createBooking()'s duplicate guard keys on — and it stays
   * correct even if the relation were ever omitted from the include.
   */
  it("reads availabilityId from the booking row, not from the joined availability", async () => {
    arrange([row({ availabilityId: "av-scalar", availability: { startTime: new Date("2026-06-01T09:00:00.000Z") } })]);

    expect((await getMyBookings()).items[0]!.availabilityId).toBe("av-scalar");
  });

  /**
   * NO NEW QUERY, NO NEW INCLUDE. Both fields are scalars already on the row, so this
   * gate must not have widened the read — the include stays exactly service+availability
   * and there is still exactly one findMany plus one count.
   */
  it("adds no query and no include to expose them", async () => {
    arrange([row()]);

    await getMyBookings();

    expect(bookingFindManyMock).toHaveBeenCalledTimes(1);
    expect(bookingCountMock).toHaveBeenCalledTimes(1);
    const arg = bookingFindManyMock.mock.calls[0]![0] as { include: Record<string, unknown> };
    expect(Object.keys(arg.include).sort()).toEqual(["availability", "service"]);
  });

  /** Ordering and pagination are untouched by this gate. */
  it("preserves deterministic ordering and pagination", async () => {
    arrange([row()]);

    await getMyBookings({ page: 2, pageSize: 5 });

    const arg = bookingFindManyMock.mock.calls[0]![0] as {
      orderBy: unknown;
      skip: number;
      take: number;
      where: Record<string, unknown>;
    };
    expect(arg.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(arg.skip).toBe(5);
    expect(arg.take).toBe(5);
    // Ownership scoping unchanged.
    expect(arg.where.customerId).toBe("c1");
  });

  /**
   * WHY availabilityId AND NOT serviceId + slot start. Two bookings on the same service
   * at the same start time are permitted by the Platform today — Availability has no
   * @@unique(serviceId, startTime), no constraint in any migration, and no overlap guard
   * in any of the four availability write paths. Only the slot id discriminates.
   */
  it("discriminates same-service, same-start bookings that the weaker key cannot", async () => {
    arrange([
      row({ id: "b1", availabilityId: "av-1" }),
      row({ id: "b2", availabilityId: "av-2" }),
    ]);

    const items = (await getMyBookings()).items;

    const weak = items.filter(
      (b) => b.serviceId === "svc-1" && b.slotStartTime?.toISOString() === "2026-06-01T09:00:00.000Z"
    );
    expect(weak).toHaveLength(2); // ambiguous

    const strong = items.filter((b) => b.availabilityId === "av-1" && b.status !== "CANCELLED");
    expect(strong.map((b) => b.id)).toEqual(["b1"]); // the server's own predicate
  });
});
