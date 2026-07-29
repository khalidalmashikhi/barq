import { describe, it, expect, vi, afterEach } from "vitest";

// Phase E.2 — regression tests for createContractFromBooking(): the
// prepared-but-unwired Booking Integration point (requirement #6).
// Confirms it rejects a nonexistent booking without burning a contract
// number, and on success creates a DRAFT row with the template's
// current version stamped plus one CREATED event.

vi.mock("server-only", () => ({}));

const findUniqueBookingMock = vi.fn();
const createContractMock = vi.fn();
const createEventMock = vi.fn();
const transactionMock = vi.fn();
const generateContractNumberMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    booking: { findUnique: (...args: unknown[]) => findUniqueBookingMock(...args) },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

vi.mock("@/lib/booking/lifecycle", () => ({
  BookingNotFoundError: class BookingNotFoundError extends Error {},
}));

vi.mock("./contract-number", () => ({
  generateContractNumber: (...args: unknown[]) => generateContractNumberMock(...args),
}));

const { createContractFromBooking } = await import("./create-contract");
const { BookingNotFoundError } = await import("@/lib/booking/lifecycle");

afterEach(() => {
  findUniqueBookingMock.mockReset();
  createContractMock.mockReset();
  createEventMock.mockReset();
  transactionMock.mockReset();
  generateContractNumberMock.mockReset();
});

describe("createContractFromBooking", () => {
  it("throws BookingNotFoundError and never generates a contract number for a nonexistent booking", async () => {
    findUniqueBookingMock.mockResolvedValue(null);

    await expect(
      createContractFromBooking({ bookingId: "missing", templateKey: "STANDARD_SERVICE", actorType: "PROVIDER" })
    ).rejects.toBeInstanceOf(BookingNotFoundError);

    expect(generateContractNumberMock).not.toHaveBeenCalled();
  });

  it("creates a DRAFT contract with the template's current version and one CREATED event", async () => {
    findUniqueBookingMock.mockResolvedValue({ id: "booking-1" });
    generateContractNumberMock.mockResolvedValue("BARQ-2026-000001");

    createContractMock.mockResolvedValue({ id: "contract-1", contractNumber: "BARQ-2026-000001" });
    createEventMock.mockResolvedValue({});
    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        bookingContract: { create: createContractMock },
        bookingContractEvent: { create: createEventMock },
      })
    );

    const result = await createContractFromBooking({
      bookingId: "booking-1",
      templateKey: "STANDARD_SERVICE",
      actorType: "PROVIDER",
      actorId: "provider-1",
    });

    expect(result).toEqual({ contractId: "contract-1", contractNumber: "BARQ-2026-000001" });
    expect(createContractMock).toHaveBeenCalledWith({
      data: {
        bookingId: "booking-1",
        contractNumber: "BARQ-2026-000001",
        templateKey: "STANDARD_SERVICE",
        templateVersion: 1,
      },
    });
    expect(createEventMock).toHaveBeenCalledWith({
      data: { contractId: "contract-1", eventType: "CREATED", actorType: "PROVIDER", actorId: "provider-1" },
    });
  });
});
