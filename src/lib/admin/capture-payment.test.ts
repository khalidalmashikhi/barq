import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.16 (Payment Capture Foundation) — regression tests for
// capturePayment(): the first real caller of
// PaymentGatewayProvider.capture(), mirroring deactivate-price.test.ts's
// mocking shape.
//
// Phase 2.24 (Provider Reference Persistence) — the existing "captures
// an INITIATED payment..." test's `captureMock` assertion of
// `toHaveBeenCalledWith({})` still passes unchanged even though the real
// call now always sends a `providerReference` key: with no
// providerReference on the fetched Payment mock, `payment.providerReference
// ?? undefined` is `undefined`, and `{}`/`{providerReference: undefined}`
// are treated as equal by toHaveBeenCalledWith's underlying toEqual
// semantics (undefined-valued keys are ignored). A new test below proves
// the opposite, previously-untested case: a Payment with a real stored
// providerReference has it read back and passed through to capture().
//
// Phase 2.25 (Payment Idempotency & Capture Safety) — the finalizing
// write moved from tx.payment.update() to tx.payment.updateMany() (an
// atomic conditional UPDATE guarded by status: "INITIATED" — see
// capture-payment.ts's own "DUPLICATE-CAPTURE SAFETY" comment), so
// paymentUpdateMock now mocks updateMany() and resolves { count: 1 } by
// default (a genuine write happened) unless a test below overrides it
// to { count: 0 } to simulate the race this phase closes: another
// request already captured the same Payment between this call's read
// and its write.

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

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
        payment: { updateMany: (...args: unknown[]) => paymentUpdateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const captureMock = vi.fn();

vi.mock("@/lib/payments/gateway/get-payment-gateway-provider", () => ({
  getPaymentGatewayProvider: () => ({ capture: (...args: unknown[]) => captureMock(...args) }),
}));

const { capturePayment } = await import("./capture-payment");

const PAYMENT_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  paymentFindUniqueMock.mockReset();
  paymentUpdateMock.mockReset();
  auditCreateMock.mockReset();
  captureMock.mockReset();
});

describe("capturePayment", () => {
  it("returns INVALID_INPUT for a malformed paymentId without checking admin status", async () => {
    const result = await capturePayment("not-a-uuid");

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns NO_ADMIN_PROFILE when the caller has no Admin profile", async () => {
    const { ForbiddenError } = await import("@/lib/auth");
    requireAdminMock.mockRejectedValue(new ForbiddenError("Admin role required"));

    const result = await capturePayment(PAYMENT_ID);

    expect(result).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
    expect(paymentUpdateMock).not.toHaveBeenCalled();
  });

  it("returns PAYMENT_NOT_FOUND when the payment doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    paymentFindUniqueMock.mockResolvedValue(null);

    const result = await capturePayment(PAYMENT_ID);

    expect(result).toEqual({ ok: false, error: "PAYMENT_NOT_FOUND" });
    expect(paymentUpdateMock).not.toHaveBeenCalled();
  });

  it("returns PAYMENT_NOT_CAPTURABLE when the payment isn't INITIATED", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    paymentFindUniqueMock.mockResolvedValue({ id: PAYMENT_ID, status: "CAPTURED" });

    const result = await capturePayment(PAYMENT_ID);

    expect(result).toEqual({ ok: false, error: "PAYMENT_NOT_CAPTURABLE" });
    expect(captureMock).not.toHaveBeenCalled();
    expect(paymentUpdateMock).not.toHaveBeenCalled();
  });

  it("captures an INITIATED payment, persists the gateway's status, and records an audit event", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    paymentFindUniqueMock.mockResolvedValue({ id: PAYMENT_ID, status: "INITIATED" });
    const occurredAt = new Date("2026-07-24T12:00:00.000Z");
    captureMock.mockResolvedValue({ status: "CAPTURED", occurredAt });
    paymentUpdateMock.mockResolvedValue({ count: 1 });
    auditCreateMock.mockResolvedValue({});

    const result = await capturePayment(PAYMENT_ID);

    expect(result).toEqual({ ok: true });
    expect(captureMock).toHaveBeenCalledWith({});
    expect(paymentUpdateMock).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID, status: "INITIATED" },
      data: { status: "CAPTURED", capturedAt: occurredAt },
    });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "ADMIN",
        actorId: "admin-1",
        action: "payment.captured",
        entityType: "Payment",
        entityId: PAYMENT_ID,
        previousValue: { status: "INITIATED" },
        newValue: { status: "CAPTURED" },
      }),
    });
  });

  it("reads the stored providerReference off the fetched Payment and passes it through to capture() (Phase 2.24)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    paymentFindUniqueMock.mockResolvedValue({ id: PAYMENT_ID, status: "INITIATED", providerReference: "pi_123" });
    const occurredAt = new Date("2026-07-24T12:00:00.000Z");
    captureMock.mockResolvedValue({ status: "CAPTURED", occurredAt });
    paymentUpdateMock.mockResolvedValue({ count: 1 });
    auditCreateMock.mockResolvedValue({});

    const result = await capturePayment(PAYMENT_ID);

    expect(result).toEqual({ ok: true });
    expect(captureMock).toHaveBeenCalledWith({ providerReference: "pi_123" });
  });

  it("does not set capturedAt when the gateway reports FAILED instead of CAPTURED", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    paymentFindUniqueMock.mockResolvedValue({ id: PAYMENT_ID, status: "INITIATED" });
    captureMock.mockResolvedValue({ status: "FAILED", occurredAt: new Date() });
    paymentUpdateMock.mockResolvedValue({ count: 1 });
    auditCreateMock.mockResolvedValue({});

    const result = await capturePayment(PAYMENT_ID);

    expect(result).toEqual({ ok: true });
    expect(paymentUpdateMock).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID, status: "INITIATED" },
      data: { status: "FAILED", capturedAt: null },
    });
  });

  it("returns PAYMENT_NOT_CAPTURABLE, and records no audit event, when another request already captured this Payment between the read and the write (Phase 2.25 concurrent-capture safety)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    // The initial read still sees INITIATED — the race is that another
    // concurrent request's transaction commits first, so THIS request's
    // own guarded updateMany() affects 0 rows.
    paymentFindUniqueMock.mockResolvedValue({ id: PAYMENT_ID, status: "INITIATED" });
    captureMock.mockResolvedValue({ status: "CAPTURED", occurredAt: new Date() });
    paymentUpdateMock.mockResolvedValue({ count: 0 });

    const result = await capturePayment(PAYMENT_ID);

    expect(result).toEqual({ ok: false, error: "PAYMENT_NOT_CAPTURABLE" });
    expect(paymentUpdateMock).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID, status: "INITIATED" },
      data: { status: "CAPTURED", capturedAt: expect.any(Date) },
    });
    expect(auditCreateMock).not.toHaveBeenCalled();
  });

  it("under two genuinely concurrent capturePayment() calls for the same Payment, exactly one succeeds and the other is safely rejected with no double audit event (Phase 2.25 concurrency test)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });

    // A tiny in-memory stand-in for the one row a real atomic
    // `UPDATE ... WHERE status = 'INITIATED'` guards — this proves the
    // guard's actual behavior under genuine concurrent invocation
    // (Promise.all), not just a single canned { count: 0 } stub.
    // paymentUpdateMock's body below never awaits between its check and
    // its mutation, so — exactly like a real database's row lock —
    // whichever of the two concurrent calls reaches it first serializes
    // ahead of the other.
    let currentStatus = "INITIATED";
    paymentFindUniqueMock.mockImplementation(async () => ({ id: PAYMENT_ID, status: currentStatus }));
    captureMock.mockResolvedValue({ status: "CAPTURED", occurredAt: new Date("2026-07-25T00:00:00.000Z") });
    paymentUpdateMock.mockImplementation(
      async ({ where, data }: { where: { status: string }; data: { status: string } }) => {
        if (currentStatus !== where.status) {
          return { count: 0 };
        }
        currentStatus = data.status;
        return { count: 1 };
      }
    );
    auditCreateMock.mockResolvedValue({});

    const results = await Promise.all([capturePayment(PAYMENT_ID), capturePayment(PAYMENT_ID)]);

    const successes = results.filter((result) => result.ok);
    const failures = results.filter((result) => !result.ok);

    expect(successes).toHaveLength(1);
    expect(failures).toEqual([{ ok: false, error: "PAYMENT_NOT_CAPTURABLE" }]);
    expect(auditCreateMock).toHaveBeenCalledTimes(1);
    expect(currentStatus).toBe("CAPTURED");
  });

  it("returns UNKNOWN_ERROR when the gateway's capture() throws (the No-Op provider's real, expected behavior today)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    paymentFindUniqueMock.mockResolvedValue({ id: PAYMENT_ID, status: "INITIATED" });
    captureMock.mockRejectedValue(new Error("no real Payment Gateway is configured"));

    const result = await capturePayment(PAYMENT_ID);

    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    expect(paymentUpdateMock).not.toHaveBeenCalled();
  });
});
