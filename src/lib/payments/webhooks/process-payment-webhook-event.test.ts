import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.17 (Payment Webhook Foundation) — regression tests for
// processPaymentWebhookEvent(), the provider-independent entry point a
// future adapter's canonical event is handed to.

vi.mock("server-only", () => ({}));

const paymentFindUniqueMock = vi.fn();
const paymentUpdateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    payment: {
      findUnique: (...args: unknown[]) => paymentFindUniqueMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        payment: { update: (...args: unknown[]) => paymentUpdateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { processPaymentWebhookEvent } = await import("./process-payment-webhook-event");

const BOOKING_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
const PAYMENT_ID = "019f4e4e-8116-7052-b15e-c0ffee000001";

function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    providerKey: "NONE",
    providerEventId: "evt_1",
    bookingId: BOOKING_ID,
    status: "CAPTURED",
    occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

afterEach(() => {
  paymentFindUniqueMock.mockReset();
  paymentUpdateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("processPaymentWebhookEvent", () => {
  it("returns INVALID_EVENT for a malformed payload without touching the database", async () => {
    const result = await processPaymentWebhookEvent({ not: "an event" });

    expect(result).toEqual({ ok: false, error: "INVALID_EVENT" });
    expect(paymentFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns UNSUPPORTED_STATUS for REFUNDED_PARTIAL, REFUNDED_FULL, and INITIATED without touching the database", async () => {
    for (const status of ["REFUNDED_PARTIAL", "REFUNDED_FULL", "INITIATED"]) {
      const result = await processPaymentWebhookEvent(baseEvent({ status }));
      expect(result).toEqual({ ok: false, error: "UNSUPPORTED_STATUS" });
    }
    expect(paymentFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns PAYMENT_NOT_FOUND when no Payment exists for the bookingId", async () => {
    paymentFindUniqueMock.mockResolvedValue(null);

    const result = await processPaymentWebhookEvent(baseEvent());

    expect(result).toEqual({ ok: false, error: "PAYMENT_NOT_FOUND" });
    expect(paymentFindUniqueMock).toHaveBeenCalledWith({ where: { bookingId: BOOKING_ID } });
    expect(paymentUpdateMock).not.toHaveBeenCalled();
  });

  it("returns ALREADY_PROCESSED without writing when the Payment is no longer capturable", async () => {
    paymentFindUniqueMock.mockResolvedValue({ id: PAYMENT_ID, status: "CAPTURED" });

    const result = await processPaymentWebhookEvent(baseEvent());

    expect(result).toEqual({ ok: true, applied: false, reason: "ALREADY_PROCESSED" });
    expect(paymentUpdateMock).not.toHaveBeenCalled();
    expect(auditCreateMock).not.toHaveBeenCalled();
  });

  it("applies a CAPTURED event to an INITIATED payment, sets capturedAt, and records a SYSTEM audit event", async () => {
    paymentFindUniqueMock.mockResolvedValue({ id: PAYMENT_ID, status: "INITIATED" });
    paymentUpdateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const occurredAt = new Date("2026-01-01T00:00:00.000Z");
    const result = await processPaymentWebhookEvent(baseEvent({ occurredAt }));

    expect(result).toEqual({ ok: true, applied: true });
    expect(paymentUpdateMock).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID },
      data: { status: "CAPTURED", capturedAt: occurredAt },
    });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "SYSTEM",
        actorId: null,
        action: "payment.webhook_processed",
        entityType: "Payment",
        entityId: PAYMENT_ID,
        previousValue: { status: "INITIATED" },
        newValue: { status: "CAPTURED", providerKey: "NONE", providerEventId: "evt_1" },
      }),
    });
  });

  it("applies a FAILED event to an INITIATED payment and leaves capturedAt null", async () => {
    paymentFindUniqueMock.mockResolvedValue({ id: PAYMENT_ID, status: "INITIATED" });
    paymentUpdateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await processPaymentWebhookEvent(baseEvent({ status: "FAILED" }));

    expect(result).toEqual({ ok: true, applied: true });
    expect(paymentUpdateMock).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID },
      data: { status: "FAILED", capturedAt: null },
    });
  });
});
