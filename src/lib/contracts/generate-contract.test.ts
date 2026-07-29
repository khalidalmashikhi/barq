import { describe, it, expect, vi, afterEach } from "vitest";

// Phase E.2 — regression tests for generateContractContent(): renders
// the contract's template against real booking/service/provider data,
// writes content/generatedAt/generatedBy exactly once, and transitions
// DRAFT -> GENERATED via the lifecycle engine (not a raw status write).

vi.mock("server-only", () => ({}));

const findUniqueContractMock = vi.fn();
const updateContractMock = vi.fn();
const transactionMock = vi.fn();
const transitionContractMock = vi.fn();
const dispatchContractHookMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    bookingContract: {
      findUnique: (...args: unknown[]) => findUniqueContractMock(...args),
      update: (...args: unknown[]) => updateContractMock(...args),
    },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

vi.mock("./lifecycle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lifecycle")>();
  return {
    ...actual,
    transitionContract: (...args: unknown[]) => transitionContractMock(...args),
    dispatchContractHook: (...args: unknown[]) => dispatchContractHookMock(...args),
  };
});

const { generateContractContent } = await import("./generate-contract");
const { BookingContractNotFoundError } = await import("./lifecycle");

const CONTRACT_WITH_BOOKING = {
  id: "contract-1",
  bookingId: "booking-1",
  contractNumber: "BARQ-2026-000001",
  templateKey: "STANDARD_SERVICE",
  booking: {
    seats: 2,
    priceSnapshotAmount: { toString: () => "60.00" },
    priceSnapshotCurrency: "OMR",
    service: { name: { ar: "جولة", en: "Tour" } },
    provider: { businessName: { ar: "شركة", en: "Company" } },
  },
};

afterEach(() => {
  findUniqueContractMock.mockReset();
  updateContractMock.mockReset();
  transactionMock.mockReset();
  transitionContractMock.mockReset();
  dispatchContractHookMock.mockReset();
});

describe("generateContractContent", () => {
  it("throws BookingContractNotFoundError for a nonexistent contract", async () => {
    findUniqueContractMock.mockResolvedValue(null);

    await expect(generateContractContent({ contractId: "missing", actorType: "PROVIDER" })).rejects.toBeInstanceOf(
      BookingContractNotFoundError
    );
  });

  it("writes rendered content, generatedAt, and generatedBy, then transitions DRAFT -> GENERATED", async () => {
    findUniqueContractMock.mockResolvedValue(CONTRACT_WITH_BOOKING);
    updateContractMock.mockResolvedValue({});

    const expectedCtx = {
      contractId: "contract-1",
      bookingId: "booking-1",
      fromStatus: "DRAFT",
      toStatus: "GENERATED",
    };
    transitionContractMock.mockResolvedValue(expectedCtx);
    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ bookingContract: { update: updateContractMock } })
    );

    const result = await generateContractContent({
      contractId: "contract-1",
      actorType: "PROVIDER",
      actorId: "provider-1",
    });

    expect(updateContractMock).toHaveBeenCalledTimes(1);
    const updateArgs = updateContractMock.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { content: unknown; generatedAt: Date; generatedByActorType: string; generatedByActorId: string };
    };
    expect(updateArgs.where).toEqual({ id: "contract-1" });
    expect(updateArgs.data.generatedByActorType).toBe("PROVIDER");
    expect(updateArgs.data.generatedByActorId).toBe("provider-1");
    expect(updateArgs.data.generatedAt).toBeInstanceOf(Date);

    const content = updateArgs.data.content as { title: { en: string }; sections: unknown[] };
    expect(content.title.en).toBe("Standard Service Contract");
    expect(JSON.stringify(content)).toContain("Tour");
    expect(JSON.stringify(content)).toContain("60.00");

    expect(transitionContractMock).toHaveBeenCalledWith(
      { contractId: "contract-1", toStatus: "GENERATED", actorType: "PROVIDER", actorId: "provider-1" },
      expect.anything()
    );
    expect(dispatchContractHookMock).toHaveBeenCalledWith(expectedCtx);
    expect(result).toEqual(expectedCtx);
  });
});
