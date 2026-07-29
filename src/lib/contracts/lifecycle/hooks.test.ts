import { describe, it, expect, vi } from "vitest";

// Phase E.2 — regression tests for the contract hook dispatcher,
// mirroring src/lib/booking/lifecycle/hooks.test.ts exactly (same
// injectable-registry technique, same reasoning for not using
// vi.spyOn on same-module bindings).

vi.mock("server-only", () => ({}));

const {
  dispatchContractHook,
  CONTRACT_HOOKS,
  onGenerated,
  onIssued,
  onActivated,
  onCompleted,
  onCancelled,
  onExpired,
} = await import("./hooks");

const baseCtx = {
  contractId: "contract-1",
  bookingId: "booking-1",
  fromStatus: "DRAFT" as const,
};

describe("CONTRACT_HOOKS registry — mapping correctness", () => {
  it("maps each status to its documented hook, by reference", () => {
    expect(CONTRACT_HOOKS.GENERATED).toBe(onGenerated);
    expect(CONTRACT_HOOKS.ISSUED).toBe(onIssued);
    expect(CONTRACT_HOOKS.ACTIVE).toBe(onActivated);
    expect(CONTRACT_HOOKS.COMPLETED).toBe(onCompleted);
    expect(CONTRACT_HOOKS.CANCELLED).toBe(onCancelled);
    expect(CONTRACT_HOOKS.EXPIRED).toBe(onExpired);
  });

  it("has no entry for DRAFT — creation is not a transition", () => {
    expect(CONTRACT_HOOKS.DRAFT).toBeUndefined();
  });
});

describe("dispatchContractHook", () => {
  it("invokes the registered hook for a known status", async () => {
    const hook = vi.fn().mockResolvedValue(undefined);
    await dispatchContractHook({ ...baseCtx, toStatus: "GENERATED" }, { GENERATED: hook });

    expect(hook).toHaveBeenCalledWith(expect.objectContaining({ toStatus: "GENERATED", contractId: "contract-1" }));
  });

  it("does nothing for a status with no registered hook", async () => {
    await expect(dispatchContractHook({ ...baseCtx, toStatus: "CANCELLED" }, {})).resolves.toBeUndefined();
  });

  it("does not throw when a hook rejects — logs and swallows instead", async () => {
    const hook = vi.fn().mockRejectedValue(new Error("downstream service unavailable"));

    await expect(
      dispatchContractHook({ ...baseCtx, toStatus: "GENERATED" }, { GENERATED: hook })
    ).resolves.toBeUndefined();
    expect(hook).toHaveBeenCalledTimes(1);
  });
});
