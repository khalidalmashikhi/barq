import { describe, it, expect, vi, afterEach } from "vitest";

// Phase E.2 — regression tests for recordContractDownloaded(): a
// standalone event recorder (not a status transition — a contract can
// be downloaded many times without its status ever changing).

vi.mock("server-only", () => ({}));

const findUniqueMock = vi.fn();
const createEventMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    bookingContract: { findUnique: (...args: unknown[]) => findUniqueMock(...args) },
    bookingContractEvent: { create: (...args: unknown[]) => createEventMock(...args) },
  },
}));

const { recordContractDownloaded } = await import("./record-contract-downloaded");
const { BookingContractNotFoundError } = await import("./lifecycle");

afterEach(() => {
  findUniqueMock.mockReset();
  createEventMock.mockReset();
});

describe("recordContractDownloaded", () => {
  it("throws BookingContractNotFoundError for a nonexistent contract, without recording an event", async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(
      recordContractDownloaded({ contractId: "missing", actorType: "CUSTOMER" })
    ).rejects.toBeInstanceOf(BookingContractNotFoundError);

    expect(createEventMock).not.toHaveBeenCalled();
  });

  it("records a DOWNLOADED event without changing any status", async () => {
    findUniqueMock.mockResolvedValue({ id: "contract-1" });
    createEventMock.mockResolvedValue({});

    await recordContractDownloaded({ contractId: "contract-1", actorType: "CUSTOMER", actorId: "customer-1" });

    expect(createEventMock).toHaveBeenCalledWith({
      data: { contractId: "contract-1", eventType: "DOWNLOADED", actorType: "CUSTOMER", actorId: "customer-1" },
    });
  });

  it("allows the same contract to be downloaded repeatedly", async () => {
    findUniqueMock.mockResolvedValue({ id: "contract-1" });
    createEventMock.mockResolvedValue({});

    await recordContractDownloaded({ contractId: "contract-1", actorType: "CUSTOMER" });
    await recordContractDownloaded({ contractId: "contract-1", actorType: "CUSTOMER" });

    expect(createEventMock).toHaveBeenCalledTimes(2);
  });
});
