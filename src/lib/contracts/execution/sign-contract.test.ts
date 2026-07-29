import { describe, it, expect, vi, afterEach } from "vitest";

// Phase E.3 — regression tests for signContract(), the core signing
// action and this phase's most important test coverage (requirement
// #9 names these scenarios explicitly): the happy path for both
// signers, invalid signing order, duplicate signatures, an expired
// execution, and — critically — that reaching EXECUTED cascades into
// the Contract Engine's own, untouched transitionContractAndFireHooks()
// to move the BookingContract itself ISSUED -> ACTIVE.

vi.mock("server-only", () => ({}));

const findUniqueExecutionMock = vi.fn();
const createSignatureMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    contractExecution: { findUnique: (...args: unknown[]) => findUniqueExecutionMock(...args) },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

const transitionContractAndFireHooksMock = vi.fn();
vi.mock("../lifecycle", () => ({
  transitionContractAndFireHooks: (...args: unknown[]) => transitionContractAndFireHooksMock(...args),
}));

const transitionExecutionMock = vi.fn();
vi.mock("./transition-execution", () => ({
  transitionExecution: (...args: unknown[]) => transitionExecutionMock(...args),
}));

const dispatchExecutionHookMock = vi.fn();
vi.mock("./hooks", () => ({
  dispatchExecutionHook: (...args: unknown[]) => dispatchExecutionHookMock(...args),
}));

const getSignatureProviderMock = vi.fn();
vi.mock("./signature-providers/get-signature-provider", () => ({
  getSignatureProvider: (...args: unknown[]) => getSignatureProviderMock(...args),
}));

const resolveSignatureIpMock = vi.fn();
vi.mock("./ip-config", () => ({
  resolveSignatureIp: (...args: unknown[]) => resolveSignatureIpMock(...args),
}));

const { signContract } = await import("./sign-contract");
const { ContractExecutionNotFoundError, NotPendingThisSignerError, ContractExecutionExpiredError } = await import(
  "./errors"
);

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);

function stubProvider() {
  getSignatureProviderMock.mockReturnValue({
    key: "INTERNAL",
    method: "INTERNAL",
    sign: vi.fn().mockResolvedValue({ signedAt: new Date("2026-07-20T10:00:00Z") }),
  });
  resolveSignatureIpMock.mockReturnValue(null);
}

function stubTransaction() {
  transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({ contractSignature: { create: createSignatureMock } })
  );
}

afterEach(() => {
  findUniqueExecutionMock.mockReset();
  createSignatureMock.mockReset();
  transactionMock.mockReset();
  transitionContractAndFireHooksMock.mockReset();
  transitionExecutionMock.mockReset();
  dispatchExecutionHookMock.mockReset();
  getSignatureProviderMock.mockReset();
  resolveSignatureIpMock.mockReset();
});

describe("signContract — not found", () => {
  it("throws ContractExecutionNotFoundError for a nonexistent contract's execution", async () => {
    findUniqueExecutionMock.mockResolvedValue(null);

    await expect(signContract({ contractId: "missing", signerType: "CUSTOMER" })).rejects.toBeInstanceOf(
      ContractExecutionNotFoundError
    );
  });
});

describe("signContract — invalid signing order / duplicate signatures (requirement #9)", () => {
  it("rejects the provider signing before the customer (invalid order)", async () => {
    findUniqueExecutionMock.mockResolvedValue({
      id: "execution-1",
      status: "PENDING_CUSTOMER",
      expiresAt: FUTURE,
    });

    await expect(signContract({ contractId: "contract-1", signerType: "PROVIDER" })).rejects.toBeInstanceOf(
      NotPendingThisSignerError
    );
    expect(createSignatureMock).not.toHaveBeenCalled();
  });

  it("rejects a customer signing twice (duplicate) once status has moved past PENDING_CUSTOMER", async () => {
    findUniqueExecutionMock.mockResolvedValue({
      id: "execution-1",
      status: "PENDING_PROVIDER", // customer already signed once
      expiresAt: FUTURE,
    });

    await expect(signContract({ contractId: "contract-1", signerType: "CUSTOMER" })).rejects.toBeInstanceOf(
      NotPendingThisSignerError
    );
    expect(createSignatureMock).not.toHaveBeenCalled();
  });

  it("rejects signing an EXECUTED contract again", async () => {
    findUniqueExecutionMock.mockResolvedValue({ id: "execution-1", status: "EXECUTED", expiresAt: FUTURE });

    await expect(signContract({ contractId: "contract-1", signerType: "PROVIDER" })).rejects.toBeInstanceOf(
      NotPendingThisSignerError
    );
  });
});

describe("signContract — expiration", () => {
  it("rejects signing once the execution's deadline has passed", async () => {
    findUniqueExecutionMock.mockResolvedValue({
      id: "execution-1",
      status: "PENDING_CUSTOMER",
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(signContract({ contractId: "contract-1", signerType: "CUSTOMER" })).rejects.toBeInstanceOf(
      ContractExecutionExpiredError
    );
    expect(createSignatureMock).not.toHaveBeenCalled();
  });
});

describe("signContract — customer signs (does not yet complete execution)", () => {
  it("creates a signature, transitions CUSTOMER_SIGNED then PENDING_PROVIDER, and does not touch the Contract Engine", async () => {
    findUniqueExecutionMock.mockResolvedValue({ id: "execution-1", status: "PENDING_CUSTOMER", expiresAt: FUTURE });
    stubProvider();
    stubTransaction();
    createSignatureMock.mockResolvedValue({ id: "signature-1" });

    transitionExecutionMock
      .mockResolvedValueOnce({
        executionId: "execution-1",
        contractId: "contract-1",
        bookingId: "booking-1",
        fromStatus: "PENDING_CUSTOMER",
        toStatus: "CUSTOMER_SIGNED",
      })
      .mockResolvedValueOnce({
        executionId: "execution-1",
        contractId: "contract-1",
        bookingId: "booking-1",
        fromStatus: "CUSTOMER_SIGNED",
        toStatus: "PENDING_PROVIDER",
      });

    const result = await signContract({
      contractId: "contract-1",
      signerType: "CUSTOMER",
      signerId: "customer-1",
      ipAddress: "203.0.113.5",
    });

    expect(createSignatureMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractId: "contract-1",
        executionId: "execution-1",
        signerType: "CUSTOMER",
        signerId: "customer-1",
        method: "INTERNAL",
        providerKey: "INTERNAL",
      }),
    });

    expect(transitionExecutionMock).toHaveBeenNthCalledWith(
      1,
      { executionId: "execution-1", toStatus: "CUSTOMER_SIGNED", actorType: "CUSTOMER", actorId: "customer-1" },
      expect.anything()
    );
    expect(transitionExecutionMock).toHaveBeenNthCalledWith(
      2,
      { executionId: "execution-1", toStatus: "PENDING_PROVIDER", actorType: "CUSTOMER", actorId: "customer-1" },
      expect.anything()
    );

    expect(dispatchExecutionHookMock).toHaveBeenCalledTimes(2);
    expect(transitionContractAndFireHooksMock).not.toHaveBeenCalled();
    expect(result).toEqual({ signatureId: "signature-1", executionStatus: "PENDING_PROVIDER" });
  });
});

describe("signContract — provider signs, completing execution", () => {
  it("transitions PROVIDER_SIGNED then EXECUTED, and cascades into the Contract Engine's ISSUED -> ACTIVE", async () => {
    findUniqueExecutionMock.mockResolvedValue({ id: "execution-1", status: "PENDING_PROVIDER", expiresAt: FUTURE });
    stubProvider();
    stubTransaction();
    createSignatureMock.mockResolvedValue({ id: "signature-2" });

    transitionExecutionMock
      .mockResolvedValueOnce({
        executionId: "execution-1",
        contractId: "contract-1",
        bookingId: "booking-1",
        fromStatus: "PENDING_PROVIDER",
        toStatus: "PROVIDER_SIGNED",
      })
      .mockResolvedValueOnce({
        executionId: "execution-1",
        contractId: "contract-1",
        bookingId: "booking-1",
        fromStatus: "PROVIDER_SIGNED",
        toStatus: "EXECUTED",
      });
    transitionContractAndFireHooksMock.mockResolvedValue({});

    const result = await signContract({ contractId: "contract-1", signerType: "PROVIDER", signerId: "provider-1" });

    expect(transitionContractAndFireHooksMock).toHaveBeenCalledWith({
      contractId: "contract-1",
      toStatus: "ACTIVE",
      actorType: "PROVIDER",
      actorId: "provider-1",
    });
    expect(result).toEqual({ signatureId: "signature-2", executionStatus: "EXECUTED" });
  });
});
