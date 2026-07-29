import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { noOpPaymentGatewayProvider } = await import("./no-op-payment-gateway-provider");

// Phase 2.15 (Payment Gateway Abstraction Foundation) — regression
// tests for the No-Op Payment Gateway provider: confirms initiate()
// honestly reports INITIATED with no fabricated provider reference,
// and that capture()/refund() always throw rather than silently
// claiming a financial outcome that never happened.
//
// Phase 2.27 (Refund Foundation) added a second refund() test proving
// the full-refund-shaped request (no amount at all, now that
// PaymentGatewayRefundRequest.amount is optional) throws exactly like
// the pre-existing partial-refund-shaped one below — both request
// shapes flow through this provider identically.

describe("noOpPaymentGatewayProvider", () => {
  it("declares key NONE", () => {
    expect(noOpPaymentGatewayProvider.key).toBe("NONE");
  });

  it("initiate() resolves with INITIATED, a real Date, and no providerReference", async () => {
    const before = Date.now();
    const result = await noOpPaymentGatewayProvider.initiate({
      bookingId: "booking-1",
      amount: "15.00",
      currency: "OMR",
    });
    const after = Date.now();

    expect(result.status).toBe("INITIATED");
    expect(result.occurredAt).toBeInstanceOf(Date);
    expect(result.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.occurredAt.getTime()).toBeLessThanOrEqual(after);
    expect(result.providerReference).toBeUndefined();
  });

  it("capture() throws rather than fabricating a captured outcome", async () => {
    await expect(noOpPaymentGatewayProvider.capture({ providerReference: "ref-1" })).rejects.toThrow(
      /no real Payment Gateway is configured/
    );
  });

  it("refund() throws rather than fabricating a refunded outcome (partial-refund-shaped request)", async () => {
    await expect(noOpPaymentGatewayProvider.refund({ providerReference: "ref-1", amount: "15.00" })).rejects.toThrow(
      /no real Payment Gateway is configured/
    );
  });

  it("refund() throws rather than fabricating a refunded outcome (full-refund-shaped request — amount omitted)", async () => {
    await expect(noOpPaymentGatewayProvider.refund({ providerReference: "ref-1" })).rejects.toThrow(
      /no real Payment Gateway is configured/
    );
  });
});
