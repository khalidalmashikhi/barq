import { describe, it, expect, vi, beforeEach } from "vitest";

// BOOKING NOTIFICATION DELIVERY — the delivery worker. Proves the enabled-gate, the guarded claim
// (concurrency), bounded retry (transient → PENDING until MAX → FAILED), permanent → FAILED, and
// no-verified-email → SKIPPED. All external boundaries (Resend, recipient resolution, prisma) mocked.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const enabledMock = vi.fn();
vi.mock("./booking-email-config", () => ({ isBookingEmailEnabled: (...a: unknown[]) => enabledMock(...a) }));

const sendMock = vi.fn();
vi.mock("./send-booking-email", () => ({ sendBookingEmail: (...a: unknown[]) => sendMock(...a) }));

const emailMock = vi.fn();
const localeMock = vi.fn();
vi.mock("./resolve-recipient", () => ({
  resolveRecipientVerifiedEmail: (...a: unknown[]) => emailMock(...a),
  resolveRecipientLocale: (...a: unknown[]) => localeMock(...a),
}));

const dedFindMany = vi.fn();
const dedUpdateMany = vi.fn();
const dedFindUnique = vi.fn();
const dedUpdate = vi.fn();
const bookingFindUnique = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    bookingEmailDelivery: {
      findMany: (...a: unknown[]) => dedFindMany(...a),
      updateMany: (...a: unknown[]) => dedUpdateMany(...a),
      findUnique: (...a: unknown[]) => dedFindUnique(...a),
      update: (...a: unknown[]) => dedUpdate(...a),
    },
    booking: { findUnique: (...a: unknown[]) => bookingFindUnique(...a) },
  },
}));

const { deliverPendingBookingEmails, MAX_DELIVERY_ATTEMPTS } = await import("./deliver-booking-emails");

const BOOKING_ROW = {
  service: { name: { en: "Desert Safari" } },
  availability: null,
  priceSnapshotAmount: null,
  priceSnapshotCurrency: null,
  pricingUnitSnapshot: null,
  billableQuantitySnapshot: null,
  bookingTotalSnapshot: null,
};

beforeEach(() => {
  enabledMock.mockReset().mockReturnValue(true);
  sendMock.mockReset();
  emailMock.mockReset().mockResolvedValue("real@example.com");
  localeMock.mockReset().mockResolvedValue("en");
  dedFindMany.mockReset();
  dedUpdateMany.mockReset().mockResolvedValue({ count: 1 }); // claim succeeds by default
  dedFindUnique.mockReset();
  dedUpdate.mockReset().mockResolvedValue({});
  bookingFindUnique.mockReset().mockResolvedValue(BOOKING_ROW);
});

function candidate(over?: Partial<{ id: string; status: string; attemptCount: number }>) {
  return { id: "d1", status: "PENDING", attemptCount: 0, ...over };
}
function delivery(over?: Partial<{ kind: string; bookingId: string; recipientUserId: string }>) {
  return { kind: "BOOKING_ACCEPTED", bookingId: "b1", recipientUserId: "u1", ...over };
}

describe("deliverPendingBookingEmails", () => {
  it("no-ops (enabled:false) when booking email is disabled — no rows touched", async () => {
    enabledMock.mockReturnValue(false);
    const r = await deliverPendingBookingEmails();
    expect(r.enabled).toBe(false);
    expect(dedFindMany).not.toHaveBeenCalled();
  });

  it("claims a PENDING row and marks SENT on a successful send", async () => {
    dedFindMany.mockResolvedValue([candidate()]);
    dedFindUnique.mockResolvedValue(delivery());
    sendMock.mockResolvedValue({ ok: true, providerMessageId: "resend_1" });

    const r = await deliverPendingBookingEmails();

    // Guarded claim on (id, status, attemptCount).
    expect(dedUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "d1", status: "PENDING", attemptCount: 0 } }),
    );
    expect(dedUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SENT" }) }));
    expect(r).toMatchObject({ enabled: true, claimed: 1, sent: 1 });
  });

  it("does NOT double-process a row another worker already claimed (updateMany count 0)", async () => {
    dedFindMany.mockResolvedValue([candidate()]);
    dedUpdateMany.mockResolvedValue({ count: 0 }); // lost the claim race

    const r = await deliverPendingBookingEmails();

    expect(r.claimed).toBe(0);
    expect(dedFindUnique).not.toHaveBeenCalled(); // never proceeds to send
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("marks SKIPPED (terminal, no send) when the recipient has no verified email", async () => {
    dedFindMany.mockResolvedValue([candidate()]);
    dedFindUnique.mockResolvedValue(delivery());
    emailMock.mockResolvedValue(null);

    const r = await deliverPendingBookingEmails();

    expect(sendMock).not.toHaveBeenCalled();
    expect(dedUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SKIPPED" }) }));
    expect(r).toMatchObject({ skipped: 1, sent: 0 });
  });

  it("a transient failure below the retry budget returns the row to PENDING (retried)", async () => {
    dedFindMany.mockResolvedValue([candidate({ attemptCount: 0 })]);
    dedFindUnique.mockResolvedValue(delivery());
    sendMock.mockResolvedValue({ ok: false, retryable: true, errorClass: "HTTP_503" });

    const r = await deliverPendingBookingEmails();

    expect(dedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "PENDING", lastError: "HTTP_503" } }),
    );
    expect(r).toMatchObject({ retried: 1, failed: 0 });
  });

  it("a transient failure at the LAST attempt becomes terminal FAILED (no infinite retry)", async () => {
    // attemptCount at claim = MAX-1 → after claim increment = MAX → exhausted.
    dedFindMany.mockResolvedValue([candidate({ attemptCount: MAX_DELIVERY_ATTEMPTS - 1 })]);
    dedFindUnique.mockResolvedValue(delivery());
    sendMock.mockResolvedValue({ ok: false, retryable: true, errorClass: "HTTP_500" });

    const r = await deliverPendingBookingEmails();

    expect(dedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "FAILED", lastError: "HTTP_500" } }),
    );
    expect(r).toMatchObject({ failed: 1, retried: 0 });
  });

  it("a permanent failure is terminal FAILED immediately (not retried)", async () => {
    dedFindMany.mockResolvedValue([candidate({ attemptCount: 0 })]);
    dedFindUnique.mockResolvedValue(delivery());
    sendMock.mockResolvedValue({ ok: false, retryable: false, errorClass: "HTTP_422" });

    const r = await deliverPendingBookingEmails();

    expect(dedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "FAILED", lastError: "HTTP_422" } }),
    );
    expect(r).toMatchObject({ failed: 1 });
  });

  it("selects PENDING and stale PROCESSING rows (stale-claim recovery)", async () => {
    dedFindMany.mockResolvedValue([]);
    await deliverPendingBookingEmails();
    const where = dedFindMany.mock.calls[0]![0].where;
    expect(where.OR).toEqual([
      { status: "PENDING" },
      { status: "PROCESSING", lastAttemptAt: { lt: expect.any(Date) } },
    ]);
  });
});
