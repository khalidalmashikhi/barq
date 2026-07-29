import { describe, it, expect, vi, afterEach } from "vitest";

// Phase E.3 — regression tests for the execution hook dispatcher,
// mirroring src/lib/contracts/lifecycle/hooks.test.ts's approach. Also
// covers the real notification wiring (onPendingProvider/onExecuted/
// onExpired) — the one hooks.ts in this codebase whose stubs are NOT
// empty no-ops, since requirement #7 explicitly asked to "reuse the
// existing notification architecture."

vi.mock("server-only", () => ({}));

const resolveContractPartiesMock = vi.fn();
const notifyContractEventMock = vi.fn();

vi.mock("./notify", () => ({
  resolveContractParties: (...args: unknown[]) => resolveContractPartiesMock(...args),
  notifyContractEvent: (...args: unknown[]) => notifyContractEventMock(...args),
}));

const {
  dispatchExecutionHook,
  EXECUTION_HOOKS,
  onCustomerSigned,
  onPendingProvider,
  onProviderSigned,
  onExecuted,
  onCancelled,
  onExpired,
} = await import("./hooks");

const baseCtx = {
  executionId: "execution-1",
  contractId: "contract-1",
  bookingId: "booking-1",
  fromStatus: "PENDING_CUSTOMER" as const,
};

afterEach(() => {
  resolveContractPartiesMock.mockReset();
  notifyContractEventMock.mockReset();
});

describe("EXECUTION_HOOKS registry — mapping correctness", () => {
  it("maps each status to its documented hook, by reference", () => {
    expect(EXECUTION_HOOKS.CUSTOMER_SIGNED).toBe(onCustomerSigned);
    expect(EXECUTION_HOOKS.PENDING_PROVIDER).toBe(onPendingProvider);
    expect(EXECUTION_HOOKS.PROVIDER_SIGNED).toBe(onProviderSigned);
    expect(EXECUTION_HOOKS.EXECUTED).toBe(onExecuted);
    expect(EXECUTION_HOOKS.CANCELLED).toBe(onCancelled);
    expect(EXECUTION_HOOKS.EXPIRED).toBe(onExpired);
  });

  it("has no entry for PENDING_CUSTOMER — that's the initial status, not a transition target", () => {
    expect(EXECUTION_HOOKS.PENDING_CUSTOMER).toBeUndefined();
  });
});

describe("onPendingProvider — Reminder to Sign", () => {
  it("notifies only the provider", async () => {
    resolveContractPartiesMock.mockResolvedValue({ customerUserId: "user-c", providerUserId: "user-p" });

    await onPendingProvider({ ...baseCtx, toStatus: "PENDING_PROVIDER" });

    expect(notifyContractEventMock).toHaveBeenCalledTimes(1);
    expect(notifyContractEventMock).toHaveBeenCalledWith({
      userId: "user-p",
      bookingId: "booking-1",
      kind: "SIGN_REMINDER",
    });
  });
});

describe("onExecuted", () => {
  it("notifies both customer and provider", async () => {
    resolveContractPartiesMock.mockResolvedValue({ customerUserId: "user-c", providerUserId: "user-p" });

    await onExecuted({ ...baseCtx, toStatus: "EXECUTED" });

    expect(notifyContractEventMock).toHaveBeenCalledTimes(2);
    expect(notifyContractEventMock).toHaveBeenCalledWith({ userId: "user-c", bookingId: "booking-1", kind: "EXECUTED" });
    expect(notifyContractEventMock).toHaveBeenCalledWith({ userId: "user-p", bookingId: "booking-1", kind: "EXECUTED" });
  });
});

describe("onExpired", () => {
  it("notifies both customer and provider", async () => {
    resolveContractPartiesMock.mockResolvedValue({ customerUserId: "user-c", providerUserId: "user-p" });

    await onExpired({ ...baseCtx, toStatus: "EXPIRED" });

    expect(notifyContractEventMock).toHaveBeenCalledTimes(2);
    expect(notifyContractEventMock).toHaveBeenCalledWith({ userId: "user-c", bookingId: "booking-1", kind: "EXPIRED" });
    expect(notifyContractEventMock).toHaveBeenCalledWith({ userId: "user-p", bookingId: "booking-1", kind: "EXPIRED" });
  });
});

describe("dispatchExecutionHook", () => {
  it("does not throw when a hook rejects — logs and swallows instead", async () => {
    const hook = vi.fn().mockRejectedValue(new Error("downstream service unavailable"));

    await expect(
      dispatchExecutionHook({ ...baseCtx, toStatus: "EXECUTED" }, { EXECUTED: hook })
    ).resolves.toBeUndefined();
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a status with no registered hook", async () => {
    await expect(dispatchExecutionHook({ ...baseCtx, toStatus: "CUSTOMER_SIGNED" }, {})).resolves.toBeUndefined();
  });
});
