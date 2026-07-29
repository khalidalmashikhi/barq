import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.13 (Invoice Foundation) — regression tests for
// completeBooking(), covering the newly-wired Invoice generation (see
// this file's own module comment for why COMPLETED, not CONFIRMED, is
// the correct lifecycle point). No test previously existed for this
// file; mirrors the mocking shape established for accept-booking.test.ts.

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

const requireProviderMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireProvider: (...args: unknown[]) => requireProviderMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const canCompleteBookingMock = vi.fn();

vi.mock("@/lib/booking/cancellation-policy", () => ({
  canCompleteBooking: (...args: unknown[]) => canCompleteBookingMock(...args),
}));

const transitionBookingMock = vi.fn();
const dispatchLifecycleHookMock = vi.fn();

vi.mock("@/lib/booking/lifecycle", () => ({
  transitionBooking: (...args: unknown[]) => transitionBookingMock(...args),
  dispatchLifecycleHook: (...args: unknown[]) => dispatchLifecycleHookMock(...args),
}));

const generateInvoiceNumberMock = vi.fn();

vi.mock("@/lib/invoicing/generate-invoice-number", () => ({
  generateInvoiceNumber: (...args: unknown[]) => generateInvoiceNumberMock(...args),
}));

const buildInvoiceContentMock = vi.fn();

vi.mock("@/lib/invoicing/build-invoice-content", () => ({
  buildInvoiceContent: (...args: unknown[]) => buildInvoiceContentMock(...args),
}));

const bookingFindUniqueMock = vi.fn();
const paymentFindUniqueMock = vi.fn();
const invoiceCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    booking: {
      findUnique: (...args: unknown[]) => bookingFindUniqueMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        payment: { findUnique: (...args: unknown[]) => paymentFindUniqueMock(...args) },
        invoice: { create: (...args: unknown[]) => invoiceCreateMock(...args) },
      }),
  },
}));

const { completeBooking } = await import("./complete-booking");

const BOOKING_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireProviderMock.mockReset();
  canCompleteBookingMock.mockReset();
  transitionBookingMock.mockReset();
  dispatchLifecycleHookMock.mockReset();
  generateInvoiceNumberMock.mockReset();
  buildInvoiceContentMock.mockReset();
  bookingFindUniqueMock.mockReset();
  paymentFindUniqueMock.mockReset();
  invoiceCreateMock.mockReset();
});

describe("completeBooking", () => {
  it("returns INVALID_INPUT for a malformed bookingId without checking provider status", async () => {
    const result = await completeBooking("not-a-uuid");

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireProviderMock).not.toHaveBeenCalled();
  });

  it("returns BOOKING_NOT_COMPLETABLE when the current status isn't eligible", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({
      id: BOOKING_ID,
      providerId: "provider-1",
      status: "CONFIRMED",
      priceSnapshotAmount: "15",
      service: { name: { ar: "أ", en: "A" } },
    });
    canCompleteBookingMock.mockReturnValue(false);

    const result = await completeBooking(BOOKING_ID);

    expect(result).toEqual({ ok: false, error: "BOOKING_NOT_COMPLETABLE" });
    expect(transitionBookingMock).not.toHaveBeenCalled();
  });

  it("generates a real Invoice linked to the existing Payment when completing", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({
      id: BOOKING_ID,
      providerId: "provider-1",
      status: "IN_PROGRESS",
      priceSnapshotAmount: { toString: () => "15" },
      priceSnapshotCurrency: "OMR",
      service: { name: { ar: "جولة", en: "Desert Tour" } },
    });
    canCompleteBookingMock.mockReturnValue(true);
    const hookContext = { bookingId: BOOKING_ID, toStatus: "COMPLETED" };
    transitionBookingMock.mockResolvedValue(hookContext);
    paymentFindUniqueMock.mockResolvedValue({ id: "payment-1", bookingId: BOOKING_ID });
    generateInvoiceNumberMock.mockResolvedValue("BARQ-2026-000001");
    buildInvoiceContentMock.mockReturnValue({ ar: "محتوى", en: "content" });
    invoiceCreateMock.mockResolvedValue({});
    dispatchLifecycleHookMock.mockResolvedValue(undefined);

    const result = await completeBooking(BOOKING_ID);

    expect(result).toEqual({ ok: true });
    expect(paymentFindUniqueMock).toHaveBeenCalledWith({ where: { bookingId: BOOKING_ID } });
    expect(buildInvoiceContentMock).toHaveBeenCalledWith({
      serviceName: { ar: "جولة", en: "Desert Tour" },
      amount: "15",
      currency: "OMR",
    });
    expect(invoiceCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: BOOKING_ID,
        paymentId: "payment-1",
        invoiceNumber: "BARQ-2026-000001",
        content: { ar: "محتوى", en: "content" },
      }),
    });
    expect(dispatchLifecycleHookMock).toHaveBeenCalledWith(hookContext);
  });

  it("creates the Invoice with a null paymentId when no Payment row exists for the booking", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({
      id: BOOKING_ID,
      providerId: "provider-1",
      status: "IN_PROGRESS",
      priceSnapshotAmount: { toString: () => "15" },
      priceSnapshotCurrency: "OMR",
      service: { name: { ar: "جولة", en: "Desert Tour" } },
    });
    canCompleteBookingMock.mockReturnValue(true);
    transitionBookingMock.mockResolvedValue({ bookingId: BOOKING_ID, toStatus: "COMPLETED" });
    paymentFindUniqueMock.mockResolvedValue(null);
    generateInvoiceNumberMock.mockResolvedValue("BARQ-2026-000002");
    buildInvoiceContentMock.mockReturnValue({ ar: "محتوى", en: "content" });
    invoiceCreateMock.mockResolvedValue({});
    dispatchLifecycleHookMock.mockResolvedValue(undefined);

    const result = await completeBooking(BOOKING_ID);

    expect(result).toEqual({ ok: true });
    expect(invoiceCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ paymentId: null }),
    });
  });

  it("does not create an Invoice when the booking somehow has no price snapshot", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({
      id: BOOKING_ID,
      providerId: "provider-1",
      status: "IN_PROGRESS",
      priceSnapshotAmount: null,
      priceSnapshotCurrency: null,
      service: { name: { ar: "جولة", en: "Desert Tour" } },
    });
    canCompleteBookingMock.mockReturnValue(true);
    transitionBookingMock.mockResolvedValue({ bookingId: BOOKING_ID, toStatus: "COMPLETED" });
    dispatchLifecycleHookMock.mockResolvedValue(undefined);

    const result = await completeBooking(BOOKING_ID);

    expect(result).toEqual({ ok: true });
    expect(invoiceCreateMock).not.toHaveBeenCalled();
  });
});
