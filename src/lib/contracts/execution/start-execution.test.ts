import { describe, it, expect, vi, afterEach } from "vitest";

// Phase E.3 — regression tests for startContractExecution(): rejects
// a nonexistent contract, rejects starting a second execution for the
// same contract (ContractExecutionAlreadyExistsError), and on success
// creates a PENDING_CUSTOMER execution with a verification token and
// sends the "Contract Ready" notification to the customer.

vi.mock("server-only", () => ({}));

const findUniqueContractMock = vi.fn();
const findUniqueExecutionMock = vi.fn();
const createExecutionMock = vi.fn();
const resolveContractPartiesMock = vi.fn();
const notifyContractEventMock = vi.fn();
const generateVerificationTokenMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    bookingContract: { findUnique: (...args: unknown[]) => findUniqueContractMock(...args) },
    contractExecution: {
      findUnique: (...args: unknown[]) => findUniqueExecutionMock(...args),
      create: (...args: unknown[]) => createExecutionMock(...args),
    },
  },
}));

vi.mock("./verification", () => ({
  generateVerificationToken: (...args: unknown[]) => generateVerificationTokenMock(...args),
}));

vi.mock("./notify", () => ({
  resolveContractParties: (...args: unknown[]) => resolveContractPartiesMock(...args),
  notifyContractEvent: (...args: unknown[]) => notifyContractEventMock(...args),
}));

const { startContractExecution } = await import("./start-execution");
const { BookingContractNotFoundError } = await import("../lifecycle");
const { ContractExecutionAlreadyExistsError } = await import("./errors");

afterEach(() => {
  findUniqueContractMock.mockReset();
  findUniqueExecutionMock.mockReset();
  createExecutionMock.mockReset();
  resolveContractPartiesMock.mockReset();
  notifyContractEventMock.mockReset();
  generateVerificationTokenMock.mockReset();
});

describe("startContractExecution", () => {
  it("throws BookingContractNotFoundError for a nonexistent contract", async () => {
    findUniqueContractMock.mockResolvedValue(null);

    await expect(startContractExecution({ contractId: "missing" })).rejects.toBeInstanceOf(
      BookingContractNotFoundError
    );
  });

  it("throws ContractExecutionAlreadyExistsError if one already exists for this contract", async () => {
    findUniqueContractMock.mockResolvedValue({ id: "contract-1", bookingId: "booking-1" });
    findUniqueExecutionMock.mockResolvedValue({ id: "existing-execution" });

    await expect(startContractExecution({ contractId: "contract-1" })).rejects.toBeInstanceOf(
      ContractExecutionAlreadyExistsError
    );
    expect(createExecutionMock).not.toHaveBeenCalled();
  });

  it("creates a PENDING_CUSTOMER execution and notifies the customer", async () => {
    findUniqueContractMock.mockResolvedValue({ id: "contract-1", bookingId: "booking-1" });
    findUniqueExecutionMock.mockResolvedValue(null);
    generateVerificationTokenMock.mockReturnValue("token-abc");
    createExecutionMock.mockResolvedValue({ id: "execution-1", verificationToken: "token-abc" });
    resolveContractPartiesMock.mockResolvedValue({ customerUserId: "user-c", providerUserId: "user-p" });
    notifyContractEventMock.mockResolvedValue(undefined);

    const result = await startContractExecution({ contractId: "contract-1" });

    expect(result).toEqual({ executionId: "execution-1", verificationToken: "token-abc" });
    expect(createExecutionMock).toHaveBeenCalledWith({
      data: { contractId: "contract-1", verificationToken: "token-abc", expiresAt: expect.any(Date) },
    });
    expect(notifyContractEventMock).toHaveBeenCalledWith({
      userId: "user-c",
      bookingId: "booking-1",
      kind: "CONTRACT_READY",
    });
  });

  it("honors a custom expiresInDays", async () => {
    findUniqueContractMock.mockResolvedValue({ id: "contract-1", bookingId: "booking-1" });
    findUniqueExecutionMock.mockResolvedValue(null);
    generateVerificationTokenMock.mockReturnValue("token-abc");
    createExecutionMock.mockResolvedValue({ id: "execution-1", verificationToken: "token-abc" });
    resolveContractPartiesMock.mockResolvedValue({ customerUserId: "user-c", providerUserId: "user-p" });

    const before = Date.now();
    await startContractExecution({ contractId: "contract-1", expiresInDays: 1 });

    const callArgs = createExecutionMock.mock.calls[0]?.[0] as { data: { expiresAt: Date } };
    const deltaMs = callArgs.data.expiresAt.getTime() - before;
    // ~1 day, allowing generous slack for test execution time.
    expect(deltaMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(deltaMs).toBeLessThan(25 * 60 * 60 * 1000);
  });
});
