import { describe, it, expect, vi, afterEach } from "vitest";

// Phase E.3 — regression tests for notify.ts: confirms
// notifyContractEvent() writes via the existing Notification model's
// own shape (bilingual content, channel, causingBookingId — Phase
// D.1's schema, unmodified), and resolveContractParties() correctly
// joins Booking -> Customer/Provider -> User to get the actual
// Notification.userId values (Booking.customerId/providerId are
// Customer.id/Provider.id, not User.id).

vi.mock("server-only", () => ({}));

const createNotificationMock = vi.fn();
const findUniqueBookingMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    notification: { create: (...args: unknown[]) => createNotificationMock(...args) },
    booking: { findUnique: (...args: unknown[]) => findUniqueBookingMock(...args) },
  },
}));

const { notifyContractEvent, resolveContractParties } = await import("./notify");
const { BookingNotFoundError } = await import("@/lib/booking/lifecycle");

afterEach(() => {
  createNotificationMock.mockReset();
  findUniqueBookingMock.mockReset();
});

describe("notifyContractEvent", () => {
  it("creates a Notification with bilingual content, EMAIL channel, and causingBookingId", async () => {
    createNotificationMock.mockResolvedValue({});

    await notifyContractEvent({ userId: "user-1", bookingId: "booking-1", kind: "CONTRACT_READY" });

    expect(createNotificationMock).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        content: expect.objectContaining({ ar: expect.any(String), en: expect.any(String) }),
        channel: "EMAIL",
        causingBookingId: "booking-1",
      },
    });
  });

  it.each(["CONTRACT_READY", "SIGN_REMINDER", "EXECUTED", "EXPIRED"] as const)(
    "has distinct, non-empty bilingual text for %s",
    async (kind) => {
      createNotificationMock.mockResolvedValue({});
      await notifyContractEvent({ userId: "user-1", bookingId: "booking-1", kind });

      const call = createNotificationMock.mock.calls[0]?.[0] as { data: { content: { ar: string; en: string } } };
      expect(call.data.content.ar.length).toBeGreaterThan(0);
      expect(call.data.content.en.length).toBeGreaterThan(0);
    }
  );
});

describe("resolveContractParties", () => {
  it("throws BookingNotFoundError for a nonexistent booking", async () => {
    findUniqueBookingMock.mockResolvedValue(null);

    await expect(resolveContractParties("missing")).rejects.toBeInstanceOf(BookingNotFoundError);
  });

  it("resolves customerUserId and providerUserId from the booking's Customer/Provider", async () => {
    findUniqueBookingMock.mockResolvedValue({
      customer: { userId: "user-customer" },
      provider: { userId: "user-provider" },
    });

    const result = await resolveContractParties("booking-1");
    expect(result).toEqual({ customerUserId: "user-customer", providerUserId: "user-provider" });
  });
});
