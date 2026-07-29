import { describe, it, expect, vi, afterEach } from "vitest";

// Phase E.3 — regression tests for recordContractViewed(): mirrors
// Phase E.2's recordContractDownloaded() test pattern.

vi.mock("server-only", () => ({}));

const findUniqueMock = vi.fn();
const createEventMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    bookingContract: { findUnique: (...args: unknown[]) => findUniqueMock(...args) },
    bookingContractEvent: { create: (...args: unknown[]) => createEventMock(...args) },
  },
}));

const { recordContractViewed } = await import("./view-contract");
const { BookingContractNotFoundError } = await import("../lifecycle");

afterEach(() => {
  findUniqueMock.mockReset();
  createEventMock.mockReset();
});

describe("recordContractViewed", () => {
  it("throws BookingContractNotFoundError for a nonexistent contract, without recording an event", async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(recordContractViewed({ contractId: "missing", actorType: "CUSTOMER" })).rejects.toBeInstanceOf(
      BookingContractNotFoundError
    );
    expect(createEventMock).not.toHaveBeenCalled();
  });

  it("records a VIEWED event without changing any status", async () => {
    findUniqueMock.mockResolvedValue({ id: "contract-1" });
    createEventMock.mockResolvedValue({});

    await recordContractViewed({ contractId: "contract-1", actorType: "CUSTOMER", actorId: "customer-1" });

    expect(createEventMock).toHaveBeenCalledWith({
      data: { contractId: "contract-1", eventType: "VIEWED", actorType: "CUSTOMER", actorId: "customer-1" },
    });
  });

  it("allows the same contract to be viewed repeatedly", async () => {
    findUniqueMock.mockResolvedValue({ id: "contract-1" });
    createEventMock.mockResolvedValue({});

    await recordContractViewed({ contractId: "contract-1", actorType: "CUSTOMER" });
    await recordContractViewed({ contractId: "contract-1", actorType: "CUSTOMER" });

    expect(createEventMock).toHaveBeenCalledTimes(2);
  });
});
