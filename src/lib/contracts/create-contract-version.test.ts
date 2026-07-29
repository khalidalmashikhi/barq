import { describe, it, expect, vi, afterEach } from "vitest";

// Phase E.2 — regression tests for createContractRevision(): the
// versioning/archive engine (requirements #5, #9). Confirms it never
// UPDATEs the previous contract's content, only sets `archivedAt` and
// logs ARCHIVED; the new row gets its own fresh contract number,
// version+1, and a supersedesContractId pointer; and that revising an
// already-archived contract is rejected (no forked history).

vi.mock("server-only", () => ({}));

const findUniqueMock = vi.fn();
const createContractMock = vi.fn();
const createEventMock = vi.fn();
const updateContractMock = vi.fn();
const transactionMock = vi.fn();
const generateContractNumberMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    bookingContract: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

vi.mock("./contract-number", () => ({
  generateContractNumber: (...args: unknown[]) => generateContractNumberMock(...args),
}));

const { createContractRevision } = await import("./create-contract-version");
const { BookingContractNotFoundError, ArchivedBookingContractError } = await import("./lifecycle");

const PREVIOUS = {
  id: "contract-1",
  bookingId: "booking-1",
  contractNumber: "BARQ-2026-000001",
  templateKey: "STANDARD_SERVICE",
  templateVersion: 1,
  version: 1,
  archivedAt: null as Date | null,
};

afterEach(() => {
  findUniqueMock.mockReset();
  createContractMock.mockReset();
  createEventMock.mockReset();
  updateContractMock.mockReset();
  transactionMock.mockReset();
  generateContractNumberMock.mockReset();
});

function stubTransaction() {
  transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      bookingContract: { create: createContractMock, update: updateContractMock },
      bookingContractEvent: { create: createEventMock },
    })
  );
}

describe("createContractRevision", () => {
  it("throws BookingContractNotFoundError for a nonexistent contract", async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(createContractRevision({ previousContractId: "missing", actorType: "PROVIDER" })).rejects.toBeInstanceOf(
      BookingContractNotFoundError
    );
  });

  it("throws ArchivedBookingContractError when the contract is already archived", async () => {
    findUniqueMock.mockResolvedValue({ ...PREVIOUS, archivedAt: new Date() });

    await expect(
      createContractRevision({ previousContractId: "contract-1", actorType: "PROVIDER" })
    ).rejects.toBeInstanceOf(ArchivedBookingContractError);

    expect(generateContractNumberMock).not.toHaveBeenCalled();
  });

  it("creates a new version, points supersedesContractId at the previous row, and archives it", async () => {
    findUniqueMock.mockResolvedValue(PREVIOUS);
    generateContractNumberMock.mockResolvedValue("BARQ-2026-000045");
    createContractMock.mockResolvedValue({ id: "contract-2", contractNumber: "BARQ-2026-000045", version: 2 });
    createEventMock.mockResolvedValue({});
    updateContractMock.mockResolvedValue({});
    stubTransaction();

    const result = await createContractRevision({
      previousContractId: "contract-1",
      actorType: "PROVIDER",
      actorId: "provider-1",
      reason: "updated pricing",
    });

    expect(result).toEqual({ contractId: "contract-2", contractNumber: "BARQ-2026-000045", version: 2 });

    expect(createContractMock).toHaveBeenCalledWith({
      data: {
        bookingId: "booking-1",
        contractNumber: "BARQ-2026-000045",
        templateKey: "STANDARD_SERVICE",
        templateVersion: 1,
        version: 2,
        supersedesContractId: "contract-1",
      },
    });

    // The previous contract's `content`/`status` are never touched —
    // only `archivedAt` is set. This is the immutability guarantee
    // (requirement #9) verified at the call-argument level.
    expect(updateContractMock).toHaveBeenCalledWith({
      where: { id: "contract-1" },
      data: { archivedAt: expect.any(Date) },
    });

    expect(createEventMock).toHaveBeenCalledWith({
      data: {
        contractId: "contract-1",
        eventType: "ARCHIVED",
        actorType: "PROVIDER",
        actorId: "provider-1",
        note: "updated pricing",
      },
    });
  });
});
