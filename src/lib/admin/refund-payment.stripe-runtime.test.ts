import { describe, it, expect, vi, afterEach } from "vitest";
import { Prisma } from "@prisma/client";

// Phase 2.28 (Refund Orchestration) — proves refundPayment() genuinely
// reaches the REAL Stripe gateway when PAYMENT_PROVIDER=STRIPE is
// configured, unlike refund-payment.test.ts (which mocks
// getPaymentGatewayProvider entirely). Mirrors
// capture-payment.stripe-runtime.test.ts's exact approach.
//
// Phase 2.29 (Refund Transaction) rewrote this file for the real
// Stripe Refund API call: stripe.refunds.create() is now mocked (the
// SDK's own network/crypto internals aren't this codebase's to test),
// and the real getPaymentGatewayProvider() factory + the real
// stripePaymentGatewayProvider.refund() are both genuinely exercised,
// including real transaction persistence via a fake in-memory Prisma
// store (mirroring payment-webhook-domain.integration.test.ts's own
// fake-store technique) so this file also proves the full
// gateway-call -> transaction-persist -> audit-event pipeline works
// end-to-end against the real Stripe provider, not just that it
// reaches the gateway.
//
// Phase 2.29A (Refund Transaction Remediation): idempotency key
// assertions dropped the requested amount (see
// stripe-payment-gateway-provider.ts's own "REFUND KEY" comment); the
// fake prisma mock gained a top-level auditLog.create alongside the
// one inside $transaction, since the PaymentGatewayPendingError path
// records an audit event outside any transaction; new tests cover a
// pending Stripe refund status (audit event recorded, nothing
// persisted to the Payment row) and a genuine concurrent test with two
// DIFFERENT refund amounts against the same PaymentIntent, proving
// only one succeeds end-to-end through the real orchestration +
// gateway pipeline.

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

type FakePayment = {
  id: string;
  status: string;
  amount: Prisma.Decimal;
  refundAmount: Prisma.Decimal | null;
  providerReference: string | null;
};

let store: Map<string, FakePayment>;
let auditLog: Array<{ action: string; previousValue: unknown; newValue: unknown }>;

const auditCreate = async ({ data }: { data: { action: string; previousValue: unknown; newValue: unknown } }) => {
  auditLog.push({ action: data.action, previousValue: data.previousValue, newValue: data.newValue });
  return {};
};

vi.mock("@/lib/db", () => ({
  prisma: {
    payment: {
      findUnique: async ({ where }: { where: { id: string } }) => store.get(where.id) ?? null,
    },
    // Top-level auditLog.create — used directly (not through a
    // transaction) by the PaymentGatewayPendingError path.
    auditLog: { create: (...args: [{ data: { action: string; previousValue: unknown; newValue: unknown } }]) => auditCreate(...args) },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        payment: {
          updateMany: async ({
            where,
            data,
          }: {
            where: { id: string; status: string };
            data: Partial<FakePayment>;
          }) => {
            const existing = store.get(where.id);
            if (!existing || existing.status !== where.status) {
              return { count: 0 };
            }
            store.set(where.id, { ...existing, ...data });
            return { count: 1 };
          },
        },
        auditLog: { create: (...args: [{ data: { action: string; previousValue: unknown; newValue: unknown } }]) => auditCreate(...args) },
      }),
  },
}));

const refundsCreateMock = vi.fn();

vi.mock("stripe", () => {
  class MockStripe {
    refunds = { create: (...args: unknown[]) => refundsCreateMock(...args) };
  }
  return { default: MockStripe };
});

const { refundPayment } = await import("./refund-payment");

const PAYMENT_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  refundsCreateMock.mockReset();
  delete process.env.PAYMENT_PROVIDER;
  delete process.env.STRIPE_SECRET_KEY;
});

describe("refundPayment with the real getPaymentGatewayProvider() factory and PAYMENT_PROVIDER=STRIPE", () => {
  it("a full refund reaches the real Stripe gateway, persists REFUNDED_FULL and refundAmount, and records one audit event", async () => {
    process.env.PAYMENT_PROVIDER = "STRIPE";
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    store = new Map([
      [
        PAYMENT_ID,
        { id: PAYMENT_ID, status: "CAPTURED", amount: new Prisma.Decimal("100.00"), refundAmount: null, providerReference: "pi_123" },
      ],
    ]);
    auditLog = [];
    refundsCreateMock.mockResolvedValue({ status: "succeeded" });

    const result = await refundPayment(PAYMENT_ID);

    expect(result).toEqual({ ok: true });
    expect(refundsCreateMock).toHaveBeenCalledWith(
      { payment_intent: "pi_123" },
      { idempotencyKey: "barq:payment:refund:pi_123" }
    );
    expect(store.get(PAYMENT_ID)?.status).toBe("REFUNDED_FULL");
    expect(store.get(PAYMENT_ID)?.refundAmount?.toFixed(2)).toBe("100.00");
    expect(auditLog).toHaveLength(1);
    expect(auditLog[0]!.action).toBe("payment.refunded");
  });

  it("a partial refund reaches the real Stripe gateway with the converted minor-units amount, persists REFUNDED_PARTIAL and the exact refundAmount", async () => {
    process.env.PAYMENT_PROVIDER = "STRIPE";
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    store = new Map([
      [
        PAYMENT_ID,
        { id: PAYMENT_ID, status: "CAPTURED", amount: new Prisma.Decimal("100.00"), refundAmount: null, providerReference: "pi_123" },
      ],
    ]);
    auditLog = [];
    refundsCreateMock.mockResolvedValue({ status: "succeeded" });

    const result = await refundPayment(PAYMENT_ID, "30.00");

    expect(result).toEqual({ ok: true });
    expect(refundsCreateMock).toHaveBeenCalledWith(
      { payment_intent: "pi_123", amount: 3000 },
      { idempotencyKey: "barq:payment:refund:pi_123" }
    );
    expect(store.get(PAYMENT_ID)?.status).toBe("REFUNDED_PARTIAL");
    expect(store.get(PAYMENT_ID)?.refundAmount?.toFixed(2)).toBe("30.00");
  });

  it("normalizes an explicit amount equal to Payment.amount to a full refund end-to-end — Stripe receives no amount, and REFUNDED_FULL (not REFUNDED_PARTIAL) is persisted (Phase 2.29A fix #1)", async () => {
    process.env.PAYMENT_PROVIDER = "STRIPE";
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    store = new Map([
      [
        PAYMENT_ID,
        { id: PAYMENT_ID, status: "CAPTURED", amount: new Prisma.Decimal("100.00"), refundAmount: null, providerReference: "pi_123" },
      ],
    ]);
    auditLog = [];
    refundsCreateMock.mockResolvedValue({ status: "succeeded" });

    const result = await refundPayment(PAYMENT_ID, "100.00");

    expect(result).toEqual({ ok: true });
    expect(refundsCreateMock).toHaveBeenCalledWith({ payment_intent: "pi_123" }, { idempotencyKey: "barq:payment:refund:pi_123" });
    expect(store.get(PAYMENT_ID)?.status).toBe("REFUNDED_FULL");
    expect(store.get(PAYMENT_ID)?.refundAmount?.toFixed(2)).toBe("100.00");
  });

  it("a pending Stripe refund status records a 'payment.refund_pending' audit event, returns UNKNOWN_ERROR, and persists nothing to the Payment row (Phase 2.29A fix #3)", async () => {
    process.env.PAYMENT_PROVIDER = "STRIPE";
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    store = new Map([
      [
        PAYMENT_ID,
        { id: PAYMENT_ID, status: "CAPTURED", amount: new Prisma.Decimal("100.00"), refundAmount: null, providerReference: "pi_123" },
      ],
    ]);
    auditLog = [];
    refundsCreateMock.mockResolvedValue({ status: "pending" });

    const result = await refundPayment(PAYMENT_ID);

    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    expect(store.get(PAYMENT_ID)?.status).toBe("CAPTURED");
    expect(store.get(PAYMENT_ID)?.refundAmount).toBeNull();
    expect(auditLog).toHaveLength(1);
    expect(auditLog[0]!.action).toBe("payment.refund_pending");
  });

  it("under two genuinely concurrent refundPayment() calls for the same Payment with DIFFERENT amounts, only one succeeds end-to-end — the other fails at Stripe's own idempotency boundary (Phase 2.29A remediation test)", async () => {
    process.env.PAYMENT_PROVIDER = "STRIPE";
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    store = new Map([
      [
        PAYMENT_ID,
        { id: PAYMENT_ID, status: "CAPTURED", amount: new Prisma.Decimal("100.00"), refundAmount: null, providerReference: "pi_123" },
      ],
    ]);
    auditLog = [];

    // Stand-in for Stripe's own real "same key, different parameters"
    // rejection — see stripe-payment-gateway-provider.test.ts's own
    // equivalent gateway-level test for the detailed rationale.
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

    const results = await Promise.all([refundPayment(PAYMENT_ID, "30.00"), refundPayment(PAYMENT_ID, "20.00")]);

    const successes = results.filter((result) => result.ok);
    const failures = results.filter((result) => !result.ok);

    expect(successes).toHaveLength(1);
    expect(failures).toEqual([{ ok: false, error: "UNKNOWN_ERROR" }]);
    expect(refundsCreateMock).toHaveBeenCalledTimes(2);
    // Exactly one refund amount was ever actually persisted — never
    // both, and never a value that doesn't match either request.
    expect(["30.00", "20.00"]).toContain(store.get(PAYMENT_ID)?.refundAmount?.toFixed(2));
  });

  it("a Stripe refund that does not report 'succeeded' throws, is caught, returns UNKNOWN_ERROR, and persists nothing — the Payment remains CAPTURED, never FAILED", async () => {
    process.env.PAYMENT_PROVIDER = "STRIPE";
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    store = new Map([
      [
        PAYMENT_ID,
        { id: PAYMENT_ID, status: "CAPTURED", amount: new Prisma.Decimal("100.00"), refundAmount: null, providerReference: "pi_123" },
      ],
    ]);
    auditLog = [];
    refundsCreateMock.mockResolvedValue({ status: "failed" });

    const result = await refundPayment(PAYMENT_ID);

    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    expect(store.get(PAYMENT_ID)?.status).toBe("CAPTURED");
    expect(auditLog).toHaveLength(0);
  });

  it("reaches the real No-Op gateway's refund() when PAYMENT_PROVIDER is unset — still UNKNOWN_ERROR, no persistence", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    store = new Map([
      [PAYMENT_ID, { id: PAYMENT_ID, status: "CAPTURED", amount: new Prisma.Decimal("100.00"), refundAmount: null, providerReference: null }],
    ]);
    auditLog = [];

    const result = await refundPayment(PAYMENT_ID);

    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    expect(store.get(PAYMENT_ID)?.status).toBe("CAPTURED");
    expect(auditLog).toHaveLength(0);
  });
});
