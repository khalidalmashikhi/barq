import { describe, it, expect, vi, afterEach } from "vitest";

// Phase E.3 — regression tests for transitionExecution(), mirroring
// src/lib/contracts/lifecycle/transition-contract.test.ts's approach:
// rejects a missing execution, rejects an invalid transition (with no
// write), and on a valid transition writes the new status, records a
// BookingContractEvent only when this transition has a mapped event
// type (PENDING_PROVIDER does not), and returns the context
// transitionExecutionAndFireHooks needs afterward.

vi.mock("server-only", () => ({}));

const findUniqueMock = vi.fn();
const updateMock = vi.fn();
const createEventMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    contractExecution: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    },
    bookingContractEvent: {
      create: (...args: unknown[]) => createEventMock(...args),
    },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

const dispatchExecutionHookMock = vi.fn();
vi.mock("./hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./hooks")>();
  return { ...actual, dispatchExecutionHook: (...args: unknown[]) => dispatchExecutionHookMock(...args) };
});

const { transitionExecution, transitionExecutionAndFireHooks } = await import("./transition-execution");
const { ContractExecutionNotFoundError, InvalidContractExecutionTransitionError } = await import("./errors");

const EXECUTION_ROW = {
  id: "execution-1",
  contractId: "contract-1",
  status: "PENDING_CUSTOMER" as const,
  contract: { bookingId: "booking-1" },
};

afterEach(() => {
  findUniqueMock.mockReset();
  updateMock.mockReset();
  createEventMock.mockReset();
  transactionMock.mockReset();
  dispatchExecutionHookMock.mockReset();
});

describe("transitionExecution", () => {
  it("throws ContractExecutionNotFoundError when the execution does not exist, without writing anything", async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(
      transitionExecution({ executionId: "missing", toStatus: "CUSTOMER_SIGNED", actorType: "CUSTOMER" })
    ).rejects.toBeInstanceOf(ContractExecutionNotFoundError);

    expect(updateMock).not.toHaveBeenCalled();
    expect(createEventMock).not.toHaveBeenCalled();
  });

  it("throws InvalidContractExecutionTransitionError for a disallowed transition", async () => {
    findUniqueMock.mockResolvedValue(EXECUTION_ROW);

    await expect(
      transitionExecution({ executionId: "execution-1", toStatus: "EXECUTED", actorType: "CUSTOMER" })
    ).rejects.toBeInstanceOf(InvalidContractExecutionTransitionError);

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("writes status and a CUSTOMER_SIGNED event on a valid transition", async () => {
    findUniqueMock.mockResolvedValue(EXECUTION_ROW);
    updateMock.mockResolvedValue({});
    createEventMock.mockResolvedValue({});

    const ctx = await transitionExecution({
      executionId: "execution-1",
      toStatus: "CUSTOMER_SIGNED",
      actorType: "CUSTOMER",
      actorId: "customer-1",
    });

    expect(updateMock).toHaveBeenCalledWith({ where: { id: "execution-1" }, data: { status: "CUSTOMER_SIGNED" } });
    expect(createEventMock).toHaveBeenCalledWith({
      data: {
        contractId: "contract-1",
        eventType: "CUSTOMER_SIGNED",
        actorType: "CUSTOMER",
        actorId: "customer-1",
        note: null,
      },
    });

    expect(ctx).toEqual({
      executionId: "execution-1",
      contractId: "contract-1",
      bookingId: "booking-1",
      fromStatus: "PENDING_CUSTOMER",
      toStatus: "CUSTOMER_SIGNED",
    });
  });

  it("writes status but records NO event for PENDING_PROVIDER (an automatic, non-timeline consequence)", async () => {
    findUniqueMock.mockResolvedValue({ ...EXECUTION_ROW, status: "CUSTOMER_SIGNED" });
    updateMock.mockResolvedValue({});

    await transitionExecution({ executionId: "execution-1", toStatus: "PENDING_PROVIDER", actorType: "CUSTOMER" });

    expect(updateMock).toHaveBeenCalledWith({ where: { id: "execution-1" }, data: { status: "PENDING_PROVIDER" } });
    expect(createEventMock).not.toHaveBeenCalled();
  });
});

describe("transitionExecutionAndFireHooks", () => {
  it("runs the transition inside $transaction, then fires the hook only after it resolves", async () => {
    findUniqueMock.mockResolvedValue(EXECUTION_ROW);
    updateMock.mockResolvedValue({});
    createEventMock.mockResolvedValue({});

    const expectedCtx = {
      executionId: "execution-1",
      contractId: "contract-1",
      bookingId: "booking-1",
      fromStatus: "PENDING_CUSTOMER",
      toStatus: "CUSTOMER_SIGNED",
    };

    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        contractExecution: { findUnique: findUniqueMock, update: updateMock },
        bookingContractEvent: { create: createEventMock },
      })
    );

    const result = await transitionExecutionAndFireHooks({
      executionId: "execution-1",
      toStatus: "CUSTOMER_SIGNED",
      actorType: "CUSTOMER",
    });

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(dispatchExecutionHookMock).toHaveBeenCalledWith(expectedCtx);
    expect(result).toEqual(expectedCtx);
  });
});
