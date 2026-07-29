import { describe, it, expect, vi } from "vitest";

// Phase 2.22A (Provider Selection Architecture Refinement) — proves the
// true production default at the HTTP boundary: with NOTHING mocked
// except @/lib/db, and PAYMENT_PROVIDER genuinely unset, a real POST to
// this route resolves through the real factories' own "NONE"/"GENERIC"
// defaults (see get-payment-gateway-provider.ts's own comment) exactly
// as it did before Stripe existed. The route itself never mentions
// "STRIPE" or any provider name — this is the direct, end-to-end proof
// that the route stayed provider-neutral and safe by default.

vi.mock("server-only", () => ({}));

const paymentFindUniqueMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    payment: { findUnique: (...args: unknown[]) => paymentFindUniqueMock(...args) },
    $transaction: async (callback: (tx: unknown) => unknown) => callback({}),
  },
}));

const { POST } = await import("./route");

describe("POST /api/webhooks/payments with no provider configured (real defaults, nothing else mocked)", () => {
  it("fails closed with 500 and never touches the database", async () => {
    const request = new Request("http://localhost/api/webhooks/payments", {
      method: "POST",
      headers: {},
      body: "{}",
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ ok: false, stage: "UNKNOWN", error: "UNKNOWN_ERROR" });
    expect(paymentFindUniqueMock).not.toHaveBeenCalled();
  });
});
