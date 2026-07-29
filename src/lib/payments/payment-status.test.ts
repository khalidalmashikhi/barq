import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getPaymentStatusLabel, getPaymentStatusBadgeVariant } = await import("./payment-status");

// Confirms every PaymentStatus gets its own distinct label key and its
// own distinct badge variant — the approved presentation explicitly
// forbids collapsing all non-CAPTURED statuses into one "Pending" bucket.

describe("getPaymentStatusLabel", () => {
  it("maps each status to a distinct translation key", () => {
    const t = (key: string) => key;
    expect(getPaymentStatusLabel("INITIATED", t)).toBe("paymentStatusInitiatedLabel");
    expect(getPaymentStatusLabel("CAPTURED", t)).toBe("paymentStatusCapturedLabel");
    expect(getPaymentStatusLabel("REFUNDED_PARTIAL", t)).toBe("paymentStatusRefundedPartialLabel");
    expect(getPaymentStatusLabel("REFUNDED_FULL", t)).toBe("paymentStatusRefundedFullLabel");
    expect(getPaymentStatusLabel("FAILED", t)).toBe("paymentStatusFailedLabel");
  });

  it("falls back to the raw status string for an unrecognized value", () => {
    const t = (key: string) => key;
    expect(getPaymentStatusLabel("SOMETHING_ELSE", t)).toBe("SOMETHING_ELSE");
  });
});

describe("getPaymentStatusBadgeVariant", () => {
  it("assigns a distinct variant to each of the 5 statuses", () => {
    const variants = [
      getPaymentStatusBadgeVariant("INITIATED"),
      getPaymentStatusBadgeVariant("CAPTURED"),
      getPaymentStatusBadgeVariant("REFUNDED_PARTIAL"),
      getPaymentStatusBadgeVariant("REFUNDED_FULL"),
      getPaymentStatusBadgeVariant("FAILED"),
    ];
    expect(new Set(variants).size).toBe(5);
  });
});
