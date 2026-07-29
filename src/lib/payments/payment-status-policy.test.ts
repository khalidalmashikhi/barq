import { describe, it, expect, vi } from "vitest";

// Phase 2.16 (Payment Capture Foundation) — regression test for
// canCapturePayment(): confirms INITIATED is the only capturable status,
// per DOMAIN_MODEL.md's "Initiated -> Captured -> ..." lifecycle.
// Relocated in Phase 2.16A (Payment Capture Domain Refactor) from
// src/lib/admin/ to src/lib/payments/ — see payment-status-policy.ts's
// own module comment for why. Test content is unchanged; only the path
// moved.
//
// Phase 2.28 (Refund Orchestration) added canRefundPayment()'s own
// regression tests below, mirroring canCapturePayment()'s exact shape.

vi.mock("server-only", () => ({}));

const { canCapturePayment, canRefundPayment } = await import("./payment-status-policy");

describe("canCapturePayment", () => {
  it("is true only for INITIATED", () => {
    expect(canCapturePayment("INITIATED")).toBe(true);
  });

  it("is false for CAPTURED, REFUNDED_PARTIAL, REFUNDED_FULL, and FAILED", () => {
    expect(canCapturePayment("CAPTURED")).toBe(false);
    expect(canCapturePayment("REFUNDED_PARTIAL")).toBe(false);
    expect(canCapturePayment("REFUNDED_FULL")).toBe(false);
    expect(canCapturePayment("FAILED")).toBe(false);
  });
});

describe("canRefundPayment", () => {
  it("is true only for CAPTURED", () => {
    expect(canRefundPayment("CAPTURED")).toBe(true);
  });

  it("is false for INITIATED, REFUNDED_PARTIAL, REFUNDED_FULL, and FAILED", () => {
    expect(canRefundPayment("INITIATED")).toBe(false);
    expect(canRefundPayment("REFUNDED_PARTIAL")).toBe(false);
    expect(canRefundPayment("REFUNDED_FULL")).toBe(false);
    expect(canRefundPayment("FAILED")).toBe(false);
  });
});
