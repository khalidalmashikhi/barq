import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Phase 2.22 (First Payment Provider) — end-to-end webhook flow test
// for POST /api/webhooks/payments now that Stripe is configured. Only
// the "stripe" SDK's constructEvent (real network/crypto internals
// aren't this codebase's to test) and @/lib/db are mocked — the route,
// the real pipeline (processPaymentWebhookRequest), the real Stripe
// verifier and adapter, and the real Payment Domain
// (processPaymentWebhookEvent) are all genuinely exercised, proving the
// full documented chain: HTTP Route -> Verifier -> Adapter -> Canonical
// Event -> Payment Domain -> Database, with Stripe now the actual
// configured provider, not a stand-in.
//
// Phase 2.22A (Provider Selection Architecture Refinement) — the route
// itself no longer names "STRIPE" anywhere; PAYMENT_PROVIDER=STRIPE is
// stubbed directly here instead, exactly the configuration a real
// deployment would set, proving the factories' own env-var resolution
// (not route-level hardcoding) is what selects Stripe end to end.

vi.mock("server-only", () => ({}));

const constructEventMock = vi.fn();

vi.mock("stripe", () => {
  class MockStripe {
    static webhooks = { constructEvent: (...args: unknown[]) => constructEventMock(...args) };
  }
  return { default: MockStripe };
});

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

const { POST } = await import("./route");

const BOOKING_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
const PAYMENT_ID = "019f4e4e-8116-7052-b15e-c0ffee000001";
const ORIGINAL_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const ORIGINAL_PROVIDER = process.env.PAYMENT_PROVIDER;

function buildRequest(body: string, headers: Record<string, string> = { "stripe-signature": "t=1,v1=real" }) {
  return new Request("http://localhost/api/webhooks/payments", { method: "POST", headers, body });
}

beforeEach(() => {
  process.env.PAYMENT_PROVIDER = "STRIPE";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_dummy";
  paymentFindUniqueMock.mockReset();
  paymentUpdateMock.mockReset();
  auditCreateMock.mockReset();
  constructEventMock.mockReset();
});

afterEach(() => {
  if (ORIGINAL_PROVIDER === undefined) {
    delete process.env.PAYMENT_PROVIDER;
  } else {
    process.env.PAYMENT_PROVIDER = ORIGINAL_PROVIDER;
  }
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  } else {
    process.env.STRIPE_WEBHOOK_SECRET = ORIGINAL_SECRET;
  }
});

describe("POST /api/webhooks/payments end-to-end with Stripe configured", () => {
  it("verifies (real Stripe verifier, mocked SDK), translates (real Stripe adapter), applies (real Payment Domain), and returns 200", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_1",
      type: "payment_intent.succeeded",
      created: 1735689600,
      data: { object: { id: "pi_123", metadata: { bookingId: BOOKING_ID } } },
    });
    paymentFindUniqueMock.mockResolvedValue({ id: PAYMENT_ID, status: "INITIATED" });
    paymentUpdateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const response = await POST(buildRequest('{"id":"evt_1","type":"payment_intent.succeeded"}'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, applied: true });
    expect(paymentUpdateMock).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID },
      data: { status: "CAPTURED", capturedAt: new Date(1735689600 * 1000) },
    });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorType: "SYSTEM", actorId: null, action: "payment.webhook_processed" }),
    });
  });

  it("returns 401 when Stripe's own SDK rejects the signature — the database is never touched", async () => {
    constructEventMock.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature for payload");
    });

    const response = await POST(buildRequest('{"id":"evt_1"}'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ ok: false, stage: "VERIFICATION", error: "INVALID_SIGNATURE" });
    expect(paymentFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the stripe-signature header is missing", async () => {
    const response = await POST(buildRequest('{"id":"evt_1"}', {}));

    expect(response.status).toBe(400);
    expect(constructEventMock).not.toHaveBeenCalled();
  });

  it("returns 500 when STRIPE_WEBHOOK_SECRET is not configured — fails closed exactly like the prior NONE default", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;

    const response = await POST(buildRequest('{"id":"evt_1"}'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ ok: false, stage: "UNKNOWN", error: "UNKNOWN_ERROR" });
    expect(paymentFindUniqueMock).not.toHaveBeenCalled();
  });
});
