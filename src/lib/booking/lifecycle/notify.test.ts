import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 4.1 ("Complete the Booking Lifecycle") — regression tests for
// the booking notification module: notifyBookingEvent() writes exactly
// one Notification row with the bilingual content for the given kind,
// and resolveBookingParties() throws BookingNotFoundError for a
// missing booking (mirrors src/lib/contracts/execution/notify.ts's own
// established shape and test coverage).

vi.mock("server-only", () => ({}));

const createMock = vi.fn();
const findUniqueMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    notification: {
      create: (...args: unknown[]) => createMock(...args),
    },
    booking: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

const { notifyBookingEvent, resolveBookingParties } = await import("./notify");
const { BookingNotFoundError } = await import("./errors");

afterEach(() => {
  createMock.mockReset();
  findUniqueMock.mockReset();
});

describe("notifyBookingEvent", () => {
  it("writes a Notification row with bilingual content, EMAIL channel, and the causing booking id", async () => {
    createMock.mockResolvedValue({});

    await notifyBookingEvent({ userId: "user-1", bookingId: "booking-1", kind: "PENDING_PROVIDER" });

    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        content: expect.objectContaining({ ar: expect.any(String), en: expect.any(String) }),
        channel: "EMAIL",
        causingBookingId: "booking-1",
      }),
    });
  });

  // TOUR-2.5A1 — the new-booking notification (PENDING_PROVIDER) carries the B3
  // structured action metadata so it becomes actionable, WITHOUT a second row.
  it("sets eventType=booking.created / entityType=Booking / entityId=bookingId for the PENDING_PROVIDER (new-booking) kind", async () => {
    createMock.mockResolvedValue({});
    await notifyBookingEvent({ userId: "user-1", bookingId: "b-1", kind: "PENDING_PROVIDER" });

    const data = createMock.mock.calls[0]![0].data;
    expect(data.eventType).toBe("booking.created");
    expect(data.entityType).toBe("Booking");
    expect(data.entityId).toBe("b-1");
    expect(data.causingBookingId).toBe("b-1"); // backward-compat retained
    expect(createMock).toHaveBeenCalledTimes(1); // exactly one row
  });

  it("does NOT add eventType for other booking kinds (only PENDING_PROVIDER is mapped today)", async () => {
    createMock.mockResolvedValue({});
    for (const kind of ["BOOKING_ACCEPTED", "BOOKING_CANCELLED", "BOOKING_EXPIRED", "NEW_REVIEW_RECEIVED"] as const) {
      createMock.mockClear();
      await notifyBookingEvent({ userId: "user-1", bookingId: "b-1", kind });
      const data = createMock.mock.calls[0]![0].data;
      expect(data.eventType).toBeUndefined();
      expect(data.entityType).toBeUndefined();
      expect(data.entityId).toBeUndefined();
      expect(data.causingBookingId).toBe("b-1"); // unchanged
    }
  });

  it.each([
    "PENDING_PROVIDER",
    "BOOKING_ACCEPTED",
    "BOOKING_REJECTED",
    "BOOKING_CANCELLED",
    "BOOKING_CANCELLED_BY_CUSTOMER",
    "BOOKING_EXPIRED",
    "PROVIDER_BOOKING_CONFIRMED",
    "PROVIDER_BOOKING_REJECTED",
    "NEW_REVIEW_RECEIVED",
  ] as const)(
    "has real, non-empty content for kind %s",
    async (kind) => {
      createMock.mockResolvedValue({});
      await notifyBookingEvent({ userId: "user-1", bookingId: "booking-1", kind });

      const { content } = createMock.mock.calls[0]![0].data;
      expect(content.ar.length).toBeGreaterThan(0);
      expect(content.en.length).toBeGreaterThan(0);
    }
  );

  it("embeds the kind itself in the stored content, so presentation can recover it without a schema change", async () => {
    createMock.mockResolvedValue({});
    await notifyBookingEvent({ userId: "user-1", bookingId: "booking-1", kind: "NEW_REVIEW_RECEIVED" });

    const { content } = createMock.mock.calls[0]![0].data;
    expect(content.kind).toBe("NEW_REVIEW_RECEIVED");
  });
});

describe("resolveBookingParties", () => {
  it("resolves the customer's and provider's User ids via the Booking relation", async () => {
    findUniqueMock.mockResolvedValue({
      customer: { userId: "user-customer-1" },
      provider: { userId: "user-provider-1" },
    });

    const parties = await resolveBookingParties("booking-1");

    expect(parties).toEqual({ customerUserId: "user-customer-1", providerUserId: "user-provider-1" });
  });

  it("throws BookingNotFoundError when the booking does not exist", async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(resolveBookingParties("missing")).rejects.toBeInstanceOf(BookingNotFoundError);
  });
});
