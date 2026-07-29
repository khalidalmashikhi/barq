import { describe, it, expect, vi, afterEach } from "vitest";
import { Prisma } from "@prisma/client";
import { PaymentGatewayPendingError } from "@/lib/payments/gateway/payment-gateway-provider";

// Phase 2.28 (Refund Orchestration) — regression tests for
// refundPayment(), mirroring capture-payment.test.ts's mocking shape.
//
// Phase 2.29 (Refund Transaction) rewrote this file for the real
// transaction: prisma.payment.updateMany() (atomic conditional UPDATE,
// mirroring capture-payment.test.ts's own Phase 2.25 mock) +
// auditLog.create() replace the earlier "no persistence at all" mocks.
// New tests cover: full refund (amount omitted), partial refund (amount
// provided and validated against Payment.amount using real Prisma
// Decimal instances — never plain numbers, matching this codebase's
// money-safety discipline), invalid amounts, and a genuine concurrent
// Promise.all test proving the same guard Phase 2.25 established for
// capture also protects refund.
//
// Phase 2.29A (Refund Transaction Remediation) added: a test proving an
// explicit amount equal to Payment.amount normalizes to a full refund
// (not persisted as REFUNDED_PARTIAL), and a test proving
// PaymentGatewayPendingError from the gateway is recorded as a
// "payment.refund_pending" audit event (via the mocked prisma client's
// own top-level auditLog.create, since that write happens outside
// $transaction — see refund-payment.ts's own "AUDIT" comment) while
// still returning UNKNOWN_ERROR and touching no Payment row.

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
    // Top-level auditLog.create — used directly (not through a
    // transaction) by the PaymentGatewayPendingError path; see
    // refund-payment.ts's own "AUDIT" comment for why.
    auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        payment: { updateMany: (...args: unknown[]) => paymentUpdateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const refundMock = vi.fn();

vi.mock("@/lib/payments/gateway/get-payment-gateway-provider", () => ({
  getPaymentGatewayProvider: () => ({ refund: (...args: unknown[]) => refundMock(...args) }),
}));

const { refundPayment } = await import("./refund-payment");

const PAYMENT_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  paymentFindUniqueMock.mockReset();
  paymentUpdateMock.mockReset();
  auditCreateMock.mockReset();
  refundMock.mockReset();
});

describe("refundPayment", () => {
  it("returns INVALID_INPUT for a malformed paymentId without checking admin status", async () => {
    const result = await refundPayment("not-a-uuid");

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns NO_ADMIN_PROFILE when the caller has no Admin profile", async () => {
    const { ForbiddenError } = await import("@/lib/auth");
    requireAdminMock.mockRejectedValue(new ForbiddenError("Admin role required"));

    const result = await refundPayment(PAYMENT_ID);

    expect(result).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
    expect(paymentFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns PAYMENT_NOT_FOUND when the payment doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    paymentFindUniqueMock.mockResolvedValue(null);

    const result = await refundPayment(PAYMENT_ID);

    expect(result).toEqual({ ok: false, error: "PAYMENT_NOT_FOUND" });
    expect(refundMock).not.toHaveBeenCalled();
  });

  it.each(["INITIATED", "FAILED", "REFUNDED_PARTIAL", "REFUNDED_FULL"])(
    "returns PAYMENT_NOT_REFUNDABLE for a %s payment — only CAPTURED is eligible",
    async (status) => {
      requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
      paymentFindUniqueMock.mockResolvedValue({ id: PAYMENT_ID, status, amount: new Prisma.Decimal("100.00") });

      const result = await refundPayment(PAYMENT_ID);

      expect(result).toEqual({ ok: false, error: "PAYMENT_NOT_REFUNDABLE" });
      expect(refundMock).not.toHaveBeenCalled();
    }
  );

  it.each(["not-a-number", "-5.00", "0", "0.00"])(
    "returns INVALID_INPUT for a malformed or non-positive amount (%s)",
    async (amount) => {
      requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
      paymentFindUniqueMock.mockResolvedValue({
        id: PAYMENT_ID,
        status: "CAPTURED",
        amount: new Prisma.Decimal("100.00"),
      });

      const result = await refundPayment(PAYMENT_ID, amount);

      expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
      expect(refundMock).not.toHaveBeenCalled();
    }
  );

  it("returns INVALID_INPUT when the requested amount exceeds the Payment's original amount", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    paymentFindUniqueMock.mockResolvedValue({ id: PAYMENT_ID, status: "CAPTURED", amount: new Prisma.Decimal("100.00") });

    const result = await refundPayment(PAYMENT_ID, "100.01");

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(refundMock).not.toHaveBeenCalled();
  });

  it("performs a full refund when amount is omitted: calls the gateway with no amount, persists REFUNDED_FULL and refundAmount = Payment.amount, records an audit event", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    paymentFindUniqueMock.mockResolvedValue({
      id: PAYMENT_ID,
      status: "CAPTURED",
      amount: new Prisma.Decimal("100.00"),
      providerReference: "pi_123",
    });
    refundMock.mockResolvedValue({ status: "REFUNDED_FULL", providerReference: "pi_123", occurredAt: new Date() });
    paymentUpdateMock.mockResolvedValue({ count: 1 });
    auditCreateMock.mockResolvedValue({});

    const result = await refundPayment(PAYMENT_ID);

    expect(result).toEqual({ ok: true });
    expect(refundMock).toHaveBeenCalledWith({ providerReference: "pi_123", amount: undefined });
    const updateCall = paymentUpdateMock.mock.calls[0]![0] as {
      where: unknown;
      data: { status: string; refundAmount: Prisma.Decimal };
    };
    expect(updateCall.where).toEqual({ id: PAYMENT_ID, status: "CAPTURED" });
    expect(updateCall.data.status).toBe("REFUNDED_FULL");
    expect(updateCall.data.refundAmount.toFixed(2)).toBe("100.00");
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "ADMIN",
        actorId: "admin-1",
        action: "payment.refunded",
        entityType: "Payment",
        entityId: PAYMENT_ID,
        previousValue: { status: "CAPTURED", refundAmount: null },
        newValue: { status: "REFUNDED_FULL", refundAmount: "100.00" },
      }),
    });
  });

  it("performs a partial refund when amount is provided: calls the gateway with that amount, persists REFUNDED_PARTIAL and refundAmount = the requested amount", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    paymentFindUniqueMock.mockResolvedValue({
      id: PAYMENT_ID,
      status: "CAPTURED",
      amount: new Prisma.Decimal("100.00"),
      providerReference: "pi_123",
    });
    refundMock.mockResolvedValue({ status: "REFUNDED_PARTIAL", providerReference: "pi_123", occurredAt: new Date() });
    paymentUpdateMock.mockResolvedValue({ count: 1 });
    auditCreateMock.mockResolvedValue({});

    const result = await refundPayment(PAYMENT_ID, "30.00");

    expect(result).toEqual({ ok: true });
    expect(refundMock).toHaveBeenCalledWith({ providerReference: "pi_123", amount: "30.00" });
    const updateCall = paymentUpdateMock.mock.calls[0]![0] as {
      where: unknown;
      data: { status: string; refundAmount: Prisma.Decimal };
    };
    expect(updateCall.where).toEqual({ id: PAYMENT_ID, status: "CAPTURED" });
    expect(updateCall.data.status).toBe("REFUNDED_PARTIAL");
    expect(updateCall.data.refundAmount.toFixed(2)).toBe("30.00");
  });

  it("normalizes a caller-supplied amount equal to Payment.amount to a full refund — calls the gateway with no amount and persists REFUNDED_FULL, not REFUNDED_PARTIAL (Phase 2.29A fix #1)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    paymentFindUniqueMock.mockResolvedValue({
      id: PAYMENT_ID,
      status: "CAPTURED",
      amount: new Prisma.Decimal("100.00"),
      providerReference: "pi_123",
    });
    refundMock.mockResolvedValue({ status: "REFUNDED_FULL", providerReference: "pi_123", occurredAt: new Date() });
    paymentUpdateMock.mockResolvedValue({ count: 1 });
    auditCreateMock.mockResolvedValue({});

    const result = await refundPayment(PAYMENT_ID, "100.00");

    expect(result).toEqual({ ok: true });
    expect(refundMock).toHaveBeenCalledWith({ providerReference: "pi_123", amount: undefined });
    const updateCall = paymentUpdateMock.mock.calls[0]![0] as { data: { status: string; refundAmount: Prisma.Decimal } };
    expect(updateCall.data.status).toBe("REFUNDED_FULL");
    expect(updateCall.data.refundAmount.toFixed(2)).toBe("100.00");
  });

  it("records a 'payment.refund_pending' audit event and returns UNKNOWN_ERROR, touching no Payment row, when the gateway throws PaymentGatewayPendingError (Phase 2.29A fix #3)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    paymentFindUniqueMock.mockResolvedValue({
      id: PAYMENT_ID,
      status: "CAPTURED",
      amount: new Prisma.Decimal("100.00"),
      providerReference: "pi_123",
    });
    refundMock.mockRejectedValue(new PaymentGatewayPendingError('Stripe reported refund status "pending"'));
    auditCreateMock.mockResolvedValue({});

    const result = await refundPayment(PAYMENT_ID);

    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    expect(paymentUpdateMock).not.toHaveBeenCalled();
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "ADMIN",
        actorId: "admin-1",
        action: "payment.refund_pending",
        entityType: "Payment",
        entityId: PAYMENT_ID,
        previousValue: { status: "CAPTURED" },
        newValue: { status: "CAPTURED", unconfirmedRefundAmount: "100.00" },
      }),
    });
  });

  it("returns UNKNOWN_ERROR when the gateway's refund() throws, and persists nothing", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    paymentFindUniqueMock.mockResolvedValue({
      id: PAYMENT_ID,
      status: "CAPTURED",
      amount: new Prisma.Decimal("100.00"),
      providerReference: "pi_123",
    });
    refundMock.mockRejectedValue(new Error("Stripe reported refund status \"failed\""));

    const result = await refundPayment(PAYMENT_ID);

    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    expect(paymentUpdateMock).not.toHaveBeenCalled();
    expect(auditCreateMock).not.toHaveBeenCalled();
  });

  it("returns PAYMENT_NOT_REFUNDABLE, and records no audit event, when another request already refunded this Payment between the read and the write (concurrent-refund safety)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    paymentFindUniqueMock.mockResolvedValue({
      id: PAYMENT_ID,
      status: "CAPTURED",
      amount: new Prisma.Decimal("100.00"),
      providerReference: "pi_123",
    });
    refundMock.mockResolvedValue({ status: "REFUNDED_FULL", providerReference: "pi_123", occurredAt: new Date() });
    paymentUpdateMock.mockResolvedValue({ count: 0 });

    const result = await refundPayment(PAYMENT_ID);

    expect(result).toEqual({ ok: false, error: "PAYMENT_NOT_REFUNDABLE" });
    expect(auditCreateMock).not.toHaveBeenCalled();
  });

  it("under two genuinely concurrent refundPayment() calls for the same Payment, exactly one succeeds and the other is safely rejected with no double audit event", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });

    let currentStatus = "CAPTURED";
    paymentFindUniqueMock.mockImplementation(async () => ({
      id: PAYMENT_ID,
      status: currentStatus,
      amount: new Prisma.Decimal("100.00"),
      providerReference: "pi_123",
    }));
    refundMock.mockResolvedValue({ status: "REFUNDED_FULL", providerReference: "pi_123", occurredAt: new Date() });
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

    const results = await Promise.all([refundPayment(PAYMENT_ID), refundPayment(PAYMENT_ID)]);

    const successes = results.filter((result) => result.ok);
    const failures = results.filter((result) => !result.ok);

    expect(successes).toHaveLength(1);
    expect(failures).toEqual([{ ok: false, error: "PAYMENT_NOT_REFUNDABLE" }]);
    expect(auditCreateMock).toHaveBeenCalledTimes(1);
    expect(currentStatus).toBe("REFUNDED_FULL");
  });
});
