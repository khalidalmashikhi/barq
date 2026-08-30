import { describe, it, expect, vi, afterEach } from "vitest";

// BOOKING FULFILLMENT LOGISTICS — domain-level tests for setBookingFulfillmentInstructions().
// Mirrors start-booking.test.ts's mocking shape. This file owns: input validation, provider-
// ownership isolation (§15 IDOR), the editable-state guard (§18), the single-column write, the
// clear path, and the invariants that it NEVER transitions status, NEVER notifies, and NEVER
// touches acceptBooking's machinery (no transaction/lifecycle hook).

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

const requireProviderMock = vi.fn();
class UnauthenticatedError extends Error {}
class ForbiddenError extends Error {}
vi.mock("@/lib/auth", () => ({
  requireProvider: (...a: unknown[]) => requireProviderMock(...a),
  UnauthenticatedError,
  ForbiddenError,
}));

const canEditMock = vi.fn();
vi.mock("@/lib/booking/cancellation-policy", () => ({
  canEditFulfillmentInstructions: (...a: unknown[]) => canEditMock(...a),
}));

const bookingFindUniqueMock = vi.fn();
const bookingUpdateMock = vi.fn();
const transactionMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    booking: {
      findUnique: (...a: unknown[]) => bookingFindUniqueMock(...a),
      update: (...a: unknown[]) => bookingUpdateMock(...a),
    },
    // Exposed so we can PROVE the action never opens a transaction (unlike acceptBooking).
    $transaction: (...a: unknown[]) => transactionMock(...a),
  },
}));

const { setBookingFulfillmentInstructions } = await import("./set-fulfillment-instructions");
// Real parser/writer are used (not mocked) — Prisma.DbNull identity matters for the clear path.
const { Prisma } = await import("@prisma/client");

const BOOKING_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

afterEach(() => {
  requireProviderMock.mockReset();
  canEditMock.mockReset();
  bookingFindUniqueMock.mockReset();
  bookingUpdateMock.mockReset();
  transactionMock.mockReset();
});

describe("setBookingFulfillmentInstructions", () => {
  it("returns INVALID_INPUT for a malformed bookingId without checking the provider", async () => {
    const result = await setBookingFulfillmentInstructions("not-a-uuid", form({ fulfillmentInstructionsEn: "x" }));
    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireProviderMock).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT for an over-length payload, before any DB read", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    const result = await setBookingFulfillmentInstructions(
      BOOKING_ID,
      form({ fulfillmentInstructionsEn: "y".repeat(1001) }),
    );
    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(bookingFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns NO_PROVIDER_PROFILE when the caller is not a provider", async () => {
    requireProviderMock.mockRejectedValue(new ForbiddenError());
    const result = await setBookingFulfillmentInstructions(BOOKING_ID, form({ fulfillmentInstructionsEn: "x" }));
    expect(result).toEqual({ ok: false, error: "NO_PROVIDER_PROFILE" });
  });

  it("returns BOOKING_NOT_FOUND for a booking owned by ANOTHER provider (ownership isolation)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({ id: BOOKING_ID, providerId: "provider-2", status: "CONFIRMED" });

    const result = await setBookingFulfillmentInstructions(BOOKING_ID, form({ fulfillmentInstructionsEn: "x" }));

    expect(result).toEqual({ ok: false, error: "BOOKING_NOT_FOUND" });
    expect(canEditMock).not.toHaveBeenCalled();
    expect(bookingUpdateMock).not.toHaveBeenCalled();
  });

  it("returns BOOKING_NOT_FOUND for a missing booking (indistinguishable from not-owned)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue(null);
    expect(await setBookingFulfillmentInstructions(BOOKING_ID, form({ fulfillmentInstructionsEn: "x" }))).toEqual({
      ok: false,
      error: "BOOKING_NOT_FOUND",
    });
  });

  it("returns BOOKING_NOT_EDITABLE for a non-editable status, without writing", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({ id: BOOKING_ID, providerId: "provider-1", status: "PENDING_PROVIDER" });
    canEditMock.mockReturnValue(false);

    const result = await setBookingFulfillmentInstructions(BOOKING_ID, form({ fulfillmentInstructionsEn: "x" }));

    expect(result).toEqual({ ok: false, error: "BOOKING_NOT_EDITABLE" });
    expect(bookingUpdateMock).not.toHaveBeenCalled();
  });

  it("writes bilingual instructions on an owned CONFIRMED booking (no transaction, no status change)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({ id: BOOKING_ID, providerId: "provider-1", status: "CONFIRMED" });
    canEditMock.mockReturnValue(true);
    bookingUpdateMock.mockResolvedValue({});

    const result = await setBookingFulfillmentInstructions(
      BOOKING_ID,
      form({ fulfillmentInstructionsAr: "  استلام من الردهة  ", fulfillmentInstructionsEn: "  Pickup at the lobby  " }),
    );

    expect(result).toEqual({ ok: true });
    expect(bookingUpdateMock).toHaveBeenCalledWith({
      where: { id: BOOKING_ID },
      data: { fulfillmentInstructions: { ar: "استلام من الردهة", en: "Pickup at the lobby" } },
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("clears the column (Prisma.DbNull) when both languages are blank", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({ id: BOOKING_ID, providerId: "provider-1", status: "IN_PROGRESS" });
    canEditMock.mockReturnValue(true);
    bookingUpdateMock.mockResolvedValue({});

    const result = await setBookingFulfillmentInstructions(
      BOOKING_ID,
      form({ fulfillmentInstructionsAr: "   ", fulfillmentInstructionsEn: "" }),
    );

    expect(result).toEqual({ ok: true });
    expect(bookingUpdateMock).toHaveBeenCalledWith({
      where: { id: BOOKING_ID },
      data: { fulfillmentInstructions: Prisma.DbNull },
    });
  });

  it("maps an unexpected DB failure to UNKNOWN_ERROR (no internal leak)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({ id: BOOKING_ID, providerId: "provider-1", status: "CONFIRMED" });
    canEditMock.mockReturnValue(true);
    bookingUpdateMock.mockRejectedValue(new Error("db exploded"));

    const result = await setBookingFulfillmentInstructions(BOOKING_ID, form({ fulfillmentInstructionsEn: "x" }));
    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
  });
});
