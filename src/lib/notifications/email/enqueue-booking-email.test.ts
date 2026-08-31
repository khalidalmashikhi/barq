import { describe, it, expect, vi, beforeEach } from "vitest";

// BOOKING NOTIFICATION DELIVERY — the post-commit durable enqueue. Proves: eligible kind → one
// outbox row; non-eligible kind → nothing; P2002 (duplicate) → silent no-op (idempotency); any
// other error → swallowed (never throws into the committed booking action).

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const createMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { bookingEmailDelivery: { create: (...a: unknown[]) => createMock(...a) } },
}));

const { enqueueBookingEmail } = await import("./enqueue-booking-email");
const { logger } = await import("@/lib/logger");

beforeEach(() => {
  createMock.mockReset();
  vi.mocked(logger.warn).mockReset();
});

describe("enqueueBookingEmail", () => {
  it("creates one PENDING row for an email-eligible kind", async () => {
    createMock.mockResolvedValue({});
    await enqueueBookingEmail({ bookingId: "b1", recipientUserId: "u1", kind: "BOOKING_ACCEPTED" });
    expect(createMock).toHaveBeenCalledWith({
      data: { bookingId: "b1", recipientUserId: "u1", kind: "BOOKING_ACCEPTED", status: "PENDING" },
    });
  });

  it("does nothing for a non-eligible kind (self-receipt / review / in-app only)", async () => {
    for (const kind of ["PROVIDER_BOOKING_CONFIRMED", "PROVIDER_BOOKING_REJECTED", "NEW_REVIEW_RECEIVED"] as const) {
      await enqueueBookingEmail({ bookingId: "b1", recipientUserId: "u1", kind });
    }
    expect(createMock).not.toHaveBeenCalled();
  });

  it("treats a P2002 duplicate as a silent idempotent no-op (no throw, no warn)", async () => {
    createMock.mockRejectedValue({ code: "P2002" });
    await expect(enqueueBookingEmail({ bookingId: "b1", recipientUserId: "u1", kind: "PENDING_PROVIDER" })).resolves.toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("swallows any other error (never throws into the committed booking action) and logs safely", async () => {
    createMock.mockRejectedValue(new Error("db blip"));
    await expect(enqueueBookingEmail({ bookingId: "b1", recipientUserId: "u1", kind: "BOOKING_EXPIRED" })).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith("bookingEmail.enqueue_failed", expect.objectContaining({ bookingId: "b1", kind: "BOOKING_EXPIRED" }));
  });
});
