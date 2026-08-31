import { describe, it, expect, vi, afterEach } from "vitest";

// BOOKING OPS OBSERVABILITY — the read-only email-delivery admin query. Proves admin-gating, the
// status filter, newest-first ordering, bounded pagination, the stale-PROCESSING signal, and that
// only sanitized/safe fields are selected (no email body/address/secret exists to leak).

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();
class ForbiddenError extends Error {}
vi.mock("@/lib/auth", () => ({ requireAdmin: (...a: unknown[]) => requireAdminMock(...a), ForbiddenError }));
vi.mock("@/lib/notifications/email/deliver-booking-emails", () => ({ STALE_CLAIM_MS: 10 * 60 * 1000 }));

const countMock = vi.fn();
const findManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    bookingEmailDelivery: {
      count: (...a: unknown[]) => countMock(...a),
      findMany: (...a: unknown[]) => findManyMock(...a),
    },
  },
}));

const { getBookingEmailDeliveries } = await import("./get-booking-email-deliveries");

const baseRow = {
  id: "d1",
  bookingId: "b1",
  recipientUserId: "u1",
  kind: "BOOKING_ACCEPTED",
  status: "SENT" as const,
  attemptCount: 1,
  lastAttemptAt: new Date("2026-05-01T00:00:00.000Z"),
  sentAt: new Date("2026-05-01T00:00:01.000Z"),
  lastError: null,
  createdAt: new Date("2026-05-01T00:00:00.000Z"),
};

afterEach(() => {
  requireAdminMock.mockReset().mockResolvedValue({ admin: { id: "admin-1" } });
  countMock.mockReset().mockResolvedValue(1);
  findManyMock.mockReset().mockResolvedValue([baseRow]);
});

describe("getBookingEmailDeliveries — authority", () => {
  it("requires admin (a ForbiddenError from requireAdmin propagates)", async () => {
    requireAdminMock.mockRejectedValue(new ForbiddenError());
    await expect(getBookingEmailDeliveries()).rejects.toBeInstanceOf(ForbiddenError);
    expect(findManyMock).not.toHaveBeenCalled();
  });
});

describe("getBookingEmailDeliveries — query shape", () => {
  it("orders newest-first and bounds the page size", async () => {
    await getBookingEmailDeliveries({ page: 2 });
    const arg = findManyMock.mock.calls[0]![0];
    expect(arg.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(arg.take).toBe(20);
    expect(arg.skip).toBe(20);
  });

  it("filters by status when provided; unfiltered otherwise", async () => {
    await getBookingEmailDeliveries({ status: "FAILED" });
    expect(findManyMock.mock.calls[0]![0].where).toEqual({ status: "FAILED" });
    expect(countMock.mock.calls[0]![0].where).toEqual({ status: "FAILED" });

    findManyMock.mockClear();
    await getBookingEmailDeliveries();
    expect(findManyMock.mock.calls[0]![0].where).toEqual({});
  });

  it("selects ONLY the safe fields — never an email address/body/secret column", async () => {
    await getBookingEmailDeliveries();
    const select = findManyMock.mock.calls[0]![0].select;
    expect(Object.keys(select).sort()).toEqual(
      ["attemptCount", "bookingId", "createdAt", "id", "kind", "lastAttemptAt", "lastError", "recipientUserId", "sentAt", "status"].sort(),
    );
    // There is no email/body/recipientEmail/apiKey column to select in the first place.
    for (const forbidden of ["recipientEmail", "email", "body", "html", "apiKey", "secret"]) {
      expect(select).not.toHaveProperty(forbidden);
    }
  });
});

describe("getBookingEmailDeliveries — stale PROCESSING signal", () => {
  it("flags a PROCESSING row whose claim is older than the stale window", async () => {
    findManyMock.mockResolvedValue([
      { ...baseRow, id: "old", status: "PROCESSING", lastAttemptAt: new Date(Date.now() - 20 * 60 * 1000) }, // 20m ago
      { ...baseRow, id: "fresh", status: "PROCESSING", lastAttemptAt: new Date(Date.now() - 60 * 1000) }, // 1m ago
      { ...baseRow, id: "sent", status: "SENT", lastAttemptAt: new Date(Date.now() - 20 * 60 * 1000) }, // not processing
    ]);
    const { items } = await getBookingEmailDeliveries();
    expect(items.find((i) => i.id === "old")!.stale).toBe(true);
    expect(items.find((i) => i.id === "fresh")!.stale).toBe(false);
    expect(items.find((i) => i.id === "sent")!.stale).toBe(false); // only PROCESSING can be stale
  });

  it("carries attemptCount, lastAttemptAt, sentAt, and the sanitized lastError through verbatim", async () => {
    findManyMock.mockResolvedValue([{ ...baseRow, status: "FAILED", attemptCount: 5, lastError: "HTTP_500", sentAt: null }]);
    const item = (await getBookingEmailDeliveries()).items[0]!;
    expect(item).toMatchObject({ status: "FAILED", attemptCount: 5, lastError: "HTTP_500", sentAt: null, bookingId: "b1" });
  });
});
