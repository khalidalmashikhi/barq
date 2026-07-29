import { describe, it, expect, vi, afterEach } from "vitest";
import { PaymentGatewayPendingError } from "../payment-gateway-provider";

// Phase 2.22 (First Payment Provider) — regression tests for
// stripePaymentGatewayProvider. The real "stripe" SDK is mocked (its
// network/crypto internals are not this codebase's to test — Stripe's
// own SDK test suite already covers that); these tests prove THIS
// file's own logic: credential handling, request shaping, and
// PaymentIntent.status -> PaymentStatus mapping.
//
// Phase 2.26 (Gateway Idempotency) — every createMock/captureMock call
// now carries a third RequestOptions argument with a deterministic
// idempotencyKey; existing assertions below were extended to include
// it, and new tests prove the key is a pure function of bookingId (for
// initiate()) / providerReference (for capture()) — the same key for
// the same identifier every time, a different key for a different one.
//
// Phase 2.27 (Refund Foundation) — refund()'s error message changed
// (no longer references the now-stale "Phase 2.22" scope exclusion);
// the pre-existing refund() test was renamed and a second one added
// proving the new full-refund-shaped request (amount omitted entirely,
// now that PaymentGatewayRefundRequest.amount is optional) is accepted
// at the type level and still safely throws, exactly like the
// pre-existing partial-refund-shaped request.
//
// Phase 2.29 (Refund Transaction) replaced both "still throws, not
// implemented" placeholder tests with real ones: refundsCreateMock
// mocks stripe.refunds.create() (the SDK's own network internals are
// not this codebase's to test), and the tests below prove full vs.
// partial request shaping, minor-units conversion reuse, idempotency
// key determinism, the "not succeeded -> throw" rule, and genuine
// concurrent convergence — mirroring the equivalent capture()/initiate()
// tests above.
//
// Phase 2.29A (Refund Transaction Remediation) fixed two real gaps
// found during review:
// (1) the idempotency key changed from providerReference+amount to
//     providerReference ALONE — two concurrent refund() calls against
//     the same PaymentIntent, whatever amount each requests, must
//     collide on Stripe's own idempotency boundary rather than
//     executing as two independent refunds; tests below updated
//     accordingly, plus a new test simulating Stripe's real
//     "same key, different parameters" rejection.
// (2) refund.status "pending"/"requires_action" now throw the
//     provider-agnostic PaymentGatewayPendingError, not a plain Error —
//     these are not terminal failures (Stripe's own docs: some refund
//     methods settle asynchronously) and refund-payment.ts treats them
//     differently (records an audit trail rather than a silent,
//     indistinguishable failure). Only "failed"/"canceled" now throw
//     the plain, terminal Error.

vi.mock("server-only", () => ({}));

const createMock = vi.fn();
const captureMock = vi.fn();
const refundsCreateMock = vi.fn();

vi.mock("stripe", () => {
  class MockStripe {
    paymentIntents = { create: (...args: unknown[]) => createMock(...args), capture: (...args: unknown[]) => captureMock(...args) };
    refunds = { create: (...args: unknown[]) => refundsCreateMock(...args) };
  }
  return { default: MockStripe };
});

const { stripePaymentGatewayProvider } = await import("./stripe-payment-gateway-provider");

const ORIGINAL_ENV = process.env.STRIPE_SECRET_KEY;

afterEach(() => {
  createMock.mockReset();
  captureMock.mockReset();
  refundsCreateMock.mockReset();
  if (ORIGINAL_ENV === undefined) {
    delete process.env.STRIPE_SECRET_KEY;
  } else {
    process.env.STRIPE_SECRET_KEY = ORIGINAL_ENV;
  }
});

describe("stripePaymentGatewayProvider", () => {
  it("declares key STRIPE", () => {
    expect(stripePaymentGatewayProvider.key).toBe("STRIPE");
  });

  it("initiate() throws a clear error when STRIPE_SECRET_KEY is not configured", async () => {
    delete process.env.STRIPE_SECRET_KEY;

    await expect(
      stripePaymentGatewayProvider.initiate({ bookingId: "booking-1", amount: "15.00", currency: "OMR" })
    ).rejects.toThrow(/STRIPE_SECRET_KEY is not configured/);
  });

  it("initiate() creates a manual-capture PaymentIntent with bookingId in metadata and amount in minor units", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    createMock.mockResolvedValue({ id: "pi_123" });

    const result = await stripePaymentGatewayProvider.initiate({
      bookingId: "booking-1",
      amount: "15.00",
      currency: "OMR",
    });

    expect(createMock).toHaveBeenCalledWith(
      {
        amount: 1500,
        currency: "omr",
        metadata: { bookingId: "booking-1" },
        capture_method: "manual",
      },
      { idempotencyKey: "barq:payment:initiate:booking-1" }
    );
    expect(result.status).toBe("INITIATED");
    expect(result.providerReference).toBe("pi_123");
    expect(result.occurredAt).toBeInstanceOf(Date);
  });

  // Phase 2.22A (Provider Selection Architecture Refinement) — money-safe
  // minor-units conversion: these specific values (19.99, 0.1, 100.05)
  // are the well-known cases where `Number(x) * 100` can drift under
  // IEEE 754 double-precision arithmetic (e.g. 19.99 * 100 ===
  // 1998.9999999999998 before rounding) — proving the integer-parsing
  // implementation produces the exact expected cent value with no
  // floating-point multiplication involved at all.
  it.each([
    ["15.00", 1500],
    ["19.99", 1999],
    ["0.10", 10],
    ["100.05", 10005],
    ["1234567.89", 123456789],
    ["5", 500],
    ["5.5", 550],
  ])("initiate() converts amount %s into exactly %i minor units without floating-point drift", async (amount, expectedMinorUnits) => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    createMock.mockResolvedValue({ id: "pi_123" });

    await stripePaymentGatewayProvider.initiate({ bookingId: "booking-1", amount, currency: "OMR" });

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ amount: expectedMinorUnits }), expect.anything());
  });

  it("initiate() derives its idempotency key purely from bookingId — same booking, same key; different booking, different key", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    createMock.mockResolvedValue({ id: "pi_123" });

    await stripePaymentGatewayProvider.initiate({ bookingId: "booking-1", amount: "15.00", currency: "OMR" });
    await stripePaymentGatewayProvider.initiate({ bookingId: "booking-1", amount: "15.00", currency: "OMR" });
    await stripePaymentGatewayProvider.initiate({ bookingId: "booking-2", amount: "15.00", currency: "OMR" });

    const idempotencyKeys = createMock.mock.calls.map((call) => (call[1] as { idempotencyKey: string }).idempotencyKey);

    expect(idempotencyKeys[0]).toBe(idempotencyKeys[1]);
    expect(idempotencyKeys[0]).not.toBe(idempotencyKeys[2]);
  });

  it("capture() requires a providerReference", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";

    await expect(stripePaymentGatewayProvider.capture({})).rejects.toThrow(/providerReference .* is required/);
    expect(captureMock).not.toHaveBeenCalled();
  });

  it("capture() maps Stripe's 'succeeded' status to CAPTURED", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    captureMock.mockResolvedValue({ id: "pi_123", status: "succeeded" });

    const result = await stripePaymentGatewayProvider.capture({ providerReference: "pi_123" });

    expect(captureMock).toHaveBeenCalledWith("pi_123", undefined, { idempotencyKey: "barq:payment:capture:pi_123" });
    expect(result.status).toBe("CAPTURED");
    expect(result.providerReference).toBe("pi_123");
  });

  it("capture() derives its idempotency key purely from providerReference — same PaymentIntent, same key; different PaymentIntent, different key", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    captureMock.mockResolvedValue({ id: "pi_123", status: "succeeded" });

    await stripePaymentGatewayProvider.capture({ providerReference: "pi_123" });
    await stripePaymentGatewayProvider.capture({ providerReference: "pi_123" });
    await stripePaymentGatewayProvider.capture({ providerReference: "pi_456" });

    const idempotencyKeys = captureMock.mock.calls.map((call) => (call[2] as { idempotencyKey: string }).idempotencyKey);

    expect(idempotencyKeys[0]).toBe(idempotencyKeys[1]);
    expect(idempotencyKeys[0]).not.toBe(idempotencyKeys[2]);
  });

  it.each(["canceled", "processing", "requires_action", "requires_capture", "requires_confirmation", "requires_payment_method"] as const)(
    "capture() maps Stripe's '%s' status to FAILED",
    async (stripeStatus) => {
      process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
      captureMock.mockResolvedValue({ id: "pi_123", status: stripeStatus });

      const result = await stripePaymentGatewayProvider.capture({ providerReference: "pi_123" });

      expect(result.status).toBe("FAILED");
    }
  );

  it("under two genuinely concurrent initiate() calls for the same booking, both converge on the same PaymentIntent (Phase 2.26 concurrent gateway test)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";

    // Stand-in for Stripe's own server-side idempotency cache: the same
    // idempotencyKey always yields the same PaymentIntent id, exactly
    // what Stripe's real API guarantees per
    // https://stripe.com/docs/api/idempotent_requests — this proves the
    // key this file derives is what makes that guarantee apply here.
    createMock.mockImplementation(async (_params: unknown, options: { idempotencyKey: string }) => ({
      id: `pi_${options.idempotencyKey}`,
    }));

    const [first, second] = await Promise.all([
      stripePaymentGatewayProvider.initiate({ bookingId: "booking-1", amount: "15.00", currency: "OMR" }),
      stripePaymentGatewayProvider.initiate({ bookingId: "booking-1", amount: "15.00", currency: "OMR" }),
    ]);

    expect(first.providerReference).toBe(second.providerReference);
  });

  it("under two genuinely concurrent capture() calls for the same PaymentIntent, both converge on the same result (Phase 2.26 concurrent gateway test)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";

    captureMock.mockImplementation(async (id: string) => ({ id, status: "succeeded" }));

    const [first, second] = await Promise.all([
      stripePaymentGatewayProvider.capture({ providerReference: "pi_123" }),
      stripePaymentGatewayProvider.capture({ providerReference: "pi_123" }),
    ]);

    expect(first.status).toBe(second.status);
    expect(first.providerReference).toBe(second.providerReference);
    expect(captureMock).toHaveBeenNthCalledWith(1, "pi_123", undefined, { idempotencyKey: "barq:payment:capture:pi_123" });
    expect(captureMock).toHaveBeenNthCalledWith(2, "pi_123", undefined, { idempotencyKey: "barq:payment:capture:pi_123" });
  });

  it("refund() requires a providerReference", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";

    await expect(stripePaymentGatewayProvider.refund({})).rejects.toThrow(/providerReference .* is required/);
    expect(refundsCreateMock).not.toHaveBeenCalled();
  });

  it("refund() with no amount (full refund) sends no amount to Stripe and returns REFUNDED_FULL", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    refundsCreateMock.mockResolvedValue({ status: "succeeded" });

    const result = await stripePaymentGatewayProvider.refund({ providerReference: "pi_123" });

    expect(refundsCreateMock).toHaveBeenCalledWith(
      { payment_intent: "pi_123" },
      { idempotencyKey: "barq:payment:refund:pi_123" }
    );
    expect(result.status).toBe("REFUNDED_FULL");
    expect(result.providerReference).toBe("pi_123");
    expect(result.occurredAt).toBeInstanceOf(Date);
  });

  it("refund() with an amount (partial refund) converts it to minor units and returns REFUNDED_PARTIAL", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    refundsCreateMock.mockResolvedValue({ status: "succeeded" });

    const result = await stripePaymentGatewayProvider.refund({ providerReference: "pi_123", amount: "19.99" });

    expect(refundsCreateMock).toHaveBeenCalledWith(
      { payment_intent: "pi_123", amount: 1999 },
      { idempotencyKey: "barq:payment:refund:pi_123" }
    );
    expect(result.status).toBe("REFUNDED_PARTIAL");
  });

  it("refund() derives its idempotency key from providerReference ALONE — the same PaymentIntent always gets the same key regardless of amount; a different PaymentIntent gets a different key (Phase 2.29A)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    refundsCreateMock.mockResolvedValue({ status: "succeeded" });

    await stripePaymentGatewayProvider.refund({ providerReference: "pi_123", amount: "30.00" });
    await stripePaymentGatewayProvider.refund({ providerReference: "pi_123", amount: "20.00" });
    await stripePaymentGatewayProvider.refund({ providerReference: "pi_123" });
    await stripePaymentGatewayProvider.refund({ providerReference: "pi_456", amount: "30.00" });

    const idempotencyKeys = refundsCreateMock.mock.calls.map((call) => (call[1] as { idempotencyKey: string }).idempotencyKey);

    expect(idempotencyKeys[0]).toBe(idempotencyKeys[1]);
    expect(idempotencyKeys[0]).toBe(idempotencyKeys[2]);
    expect(idempotencyKeys[0]).not.toBe(idempotencyKeys[3]);
  });

  it.each(["pending", "requires_action"])(
    "refund() throws PaymentGatewayPendingError (not a plain Error) when Stripe reports '%s' — not yet a terminal outcome (Phase 2.29A)",
    async (stripeStatus) => {
      process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
      refundsCreateMock.mockResolvedValue({ status: stripeStatus });

      await expect(stripePaymentGatewayProvider.refund({ providerReference: "pi_123" })).rejects.toThrow(
        PaymentGatewayPendingError
      );
    }
  );

  it.each(["failed", "canceled"])(
    "refund() throws a plain (terminal) Error when Stripe reports '%s' — never returns a FAILED result",
    async (stripeStatus) => {
      process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
      refundsCreateMock.mockResolvedValue({ status: stripeStatus });

      let caught: unknown;
      try {
        await stripePaymentGatewayProvider.refund({ providerReference: "pi_123" });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(PaymentGatewayPendingError);
      expect((caught as Error).message).toMatch(/not "succeeded"/);
    }
  );

  it("under two genuinely concurrent refund() calls for the same PaymentIntent and amount, both converge on the same result (Phase 2.29 concurrent gateway test)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    refundsCreateMock.mockResolvedValue({ status: "succeeded" });

    const [first, second] = await Promise.all([
      stripePaymentGatewayProvider.refund({ providerReference: "pi_123", amount: "30.00" }),
      stripePaymentGatewayProvider.refund({ providerReference: "pi_123", amount: "30.00" }),
    ]);

    expect(first.status).toBe(second.status);
    expect(first.providerReference).toBe(second.providerReference);
    expect(refundsCreateMock).toHaveBeenNthCalledWith(
      1,
      { payment_intent: "pi_123", amount: 3000 },
      { idempotencyKey: "barq:payment:refund:pi_123" }
    );
    expect(refundsCreateMock).toHaveBeenNthCalledWith(
      2,
      { payment_intent: "pi_123", amount: 3000 },
      { idempotencyKey: "barq:payment:refund:pi_123" }
    );
  });

  it("under two genuinely concurrent refund() calls for the same PaymentIntent with DIFFERENT amounts, only one external operation succeeds — the other is rejected at Stripe's own idempotency-key boundary (Phase 2.29A remediation test)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";

    // Stand-in for Stripe's own real behavior: reusing an idempotency
    // key with DIFFERENT request parameters is rejected
    // (https://stripe.com/docs/api/idempotent_requests — "if a key is
    // reused for a request with different parameters, the request will
    // be rejected"), not silently allowed to execute as a second,
    // independent refund. No internal `await` occurs between checking
    // and recording the key below, so — exactly like a real database
    // row lock — whichever of the two concurrent calls reaches this
    // mock first serializes ahead of the other.
    const seenRequestsByKey = new Map<string, unknown>();
    refundsCreateMock.mockImplementation(async (params: unknown, options: { idempotencyKey: string }) => {
      const existing = seenRequestsByKey.get(options.idempotencyKey);
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(params)) {
          throw new Error("Keys for idempotent requests can only be used with the same parameters they were first used with.");
        }
        return { status: "succeeded" };
      }
      seenRequestsByKey.set(options.idempotencyKey, params);
      return { status: "succeeded" };
    });

    const results = await Promise.allSettled([
      stripePaymentGatewayProvider.refund({ providerReference: "pi_123", amount: "30.00" }),
      stripePaymentGatewayProvider.refund({ providerReference: "pi_123", amount: "20.00" }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(refundsCreateMock).toHaveBeenCalledTimes(2);
    // Both calls carried the SAME idempotency key (providerReference
    // alone) — this is precisely what forces the second one to collide
    // with the first instead of executing as an independent refund.
    const idempotencyKeys = refundsCreateMock.mock.calls.map((call) => (call[1] as { idempotencyKey: string }).idempotencyKey);
    expect(idempotencyKeys[0]).toBe(idempotencyKeys[1]);
  });
});
