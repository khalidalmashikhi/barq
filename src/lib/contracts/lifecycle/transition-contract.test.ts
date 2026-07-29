import { describe, it, expect, vi, afterEach } from "vitest";

// Phase E.2 — regression tests for transitionContract(), mirroring
// src/lib/booking/lifecycle/transition-booking.test.ts's approach:
// rejects a missing contract, rejects an archived contract (Phase E.2
// has no Booking-engine equivalent for this), rejects an invalid
// transition (with no write), and on a valid transition writes the new
// status, records exactly one BookingContractEvent with the correct
// eventType, and returns the context transitionContractAndFireHooks
// needs to fire the lifecycle hook afterward.

vi.mock("server-only", () => ({}));

const findUniqueMock = vi.fn();
const updateMock = vi.fn();
const createEventMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    bookingContract: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    },
    bookingContractEvent: {
      create: (...args: unknown[]) => createEventMock(...args),
    },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

const dispatchContractHookMock = vi.fn();
vi.mock("./hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./hooks")>();
  return { ...actual, dispatchContractHook: (...args: unknown[]) => dispatchContractHookMock(...args) };
});

const { transitionContract, transitionContractAndFireHooks } = await import("./transition-contract");
const { BookingContractNotFoundError, InvalidBookingContractTransitionError, ArchivedBookingContractError } =
  await import("./errors");

const CONTRACT_ROW = {
  id: "contract-1",
  bookingId: "booking-1",
  status: "DRAFT" as const,
  archivedAt: null as Date | null,
};

afterEach(() => {
  findUniqueMock.mockReset();
  updateMock.mockReset();
  createEventMock.mockReset();
  transactionMock.mockReset();
  dispatchContractHookMock.mockReset();
});

describe("transitionContract", () => {
  it("throws BookingContractNotFoundError when the contract does not exist, without writing anything", async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(
      transitionContract({ contractId: "missing", toStatus: "GENERATED", actorType: "SYSTEM" })
    ).rejects.toBeInstanceOf(BookingContractNotFoundError);

    expect(updateMock).not.toHaveBeenCalled();
    expect(createEventMock).not.toHaveBeenCalled();
  });

  it("throws ArchivedBookingContractError for an archived contract, without writing anything", async () => {
    findUniqueMock.mockResolvedValue({ ...CONTRACT_ROW, archivedAt: new Date() });

    await expect(
      transitionContract({ contractId: "contract-1", toStatus: "GENERATED", actorType: "SYSTEM" })
    ).rejects.toBeInstanceOf(ArchivedBookingContractError);

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws InvalidBookingContractTransitionError for a disallowed transition, without writing anything", async () => {
    findUniqueMock.mockResolvedValue(CONTRACT_ROW);

    await expect(
      transitionContract({ contractId: "contract-1", toStatus: "ACTIVE", actorType: "SYSTEM" })
    ).rejects.toBeInstanceOf(InvalidBookingContractTransitionError);

    expect(updateMock).not.toHaveBeenCalled();
    expect(createEventMock).not.toHaveBeenCalled();
  });

  it("writes status and one GENERATED event on a valid DRAFT -> GENERATED transition", async () => {
    findUniqueMock.mockResolvedValue(CONTRACT_ROW);
    updateMock.mockResolvedValue({});
    createEventMock.mockResolvedValue({});

    const ctx = await transitionContract({
      contractId: "contract-1",
      toStatus: "GENERATED",
      actorType: "PROVIDER",
      actorId: "provider-1",
    });

    expect(updateMock).toHaveBeenCalledWith({ where: { id: "contract-1" }, data: { status: "GENERATED" } });
    expect(createEventMock).toHaveBeenCalledWith({
      data: {
        contractId: "contract-1",
        eventType: "GENERATED",
        actorType: "PROVIDER",
        actorId: "provider-1",
        note: null,
      },
    });

    expect(ctx).toEqual({
      contractId: "contract-1",
      bookingId: "booking-1",
      fromStatus: "DRAFT",
      toStatus: "GENERATED",
    });
  });
});

describe("transitionContractAndFireHooks", () => {
  it("runs the transition inside $transaction, then fires the hook only after it resolves", async () => {
    findUniqueMock.mockResolvedValue(CONTRACT_ROW);
    updateMock.mockResolvedValue({});
    createEventMock.mockResolvedValue({});

    const expectedCtx = {
      contractId: "contract-1",
      bookingId: "booking-1",
      fromStatus: "DRAFT",
      toStatus: "GENERATED",
    };

    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      return callback({
        bookingContract: { findUnique: findUniqueMock, update: updateMock },
        bookingContractEvent: { create: createEventMock },
      });
    });

    const result = await transitionContractAndFireHooks({
      contractId: "contract-1",
      toStatus: "GENERATED",
      actorType: "PROVIDER",
    });

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(dispatchContractHookMock).toHaveBeenCalledWith(expectedCtx);
    expect(result).toEqual(expectedCtx);
  });
});
