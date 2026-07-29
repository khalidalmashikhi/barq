import "server-only";
import type { ContractExecutionStatus } from "@prisma/client";
import { logger } from "@/lib/logger";
import { notifyContractEvent, resolveContractParties } from "./notify";

// Signature Execution Engine — Phase E.3. Extension points for future
// modules to attach behavior to an execution transition — mirrors
// src/lib/contracts/lifecycle/hooks.ts's design and rationale exactly.
//
// Requirement #7 ("Prepare hooks for: Contract Ready, Reminder to
// Sign, Executed, Expired"): onPendingProvider is "Reminder to Sign"
// (the provider's turn just started); onExecuted and onExpired are
// named identically to the requirement. "Contract Ready" (the very
// first notification, once a contract is issued and its signing
// workflow begins) is fired from start-execution.ts directly, not
// from here — it corresponds to starting an execution, not any single
// ContractExecutionStatus transition.
//
// Real notification-sending (via notify.ts, reusing the existing
// Notification model) is wired into these hooks in notify.ts itself —
// this file only defines the dispatch mechanism, matching every other
// hooks.ts in this codebase.

export interface ExecutionHookContext {
  executionId: string;
  contractId: string;
  bookingId: string;
  fromStatus: ContractExecutionStatus | null;
  toStatus: ContractExecutionStatus;
}

export async function onCustomerSigned(ctx: ExecutionHookContext): Promise<void> {
  void ctx; // Extension point: audit/analytics on the customer's own signature completing.
}

export async function onPendingProvider(ctx: ExecutionHookContext): Promise<void> {
  // Requirement #7 "Reminder to Sign" — the provider's turn just started.
  const parties = await resolveContractParties(ctx.bookingId);
  await notifyContractEvent({ userId: parties.providerUserId, bookingId: ctx.bookingId, kind: "SIGN_REMINDER" });
}

export async function onProviderSigned(ctx: ExecutionHookContext): Promise<void> {
  void ctx; // Extension point: audit/analytics on the provider's own signature completing.
}

export async function onExecuted(ctx: ExecutionHookContext): Promise<void> {
  // Requirement #7 "Executed" — notify both parties the contract is fully signed.
  const parties = await resolveContractParties(ctx.bookingId);
  await notifyContractEvent({ userId: parties.customerUserId, bookingId: ctx.bookingId, kind: "EXECUTED" });
  await notifyContractEvent({ userId: parties.providerUserId, bookingId: ctx.bookingId, kind: "EXECUTED" });
}

export async function onCancelled(ctx: ExecutionHookContext): Promise<void> {
  void ctx; // Extension point: notify parties the signing workflow was cancelled.
}

export async function onExpired(ctx: ExecutionHookContext): Promise<void> {
  // Requirement #7 "Expired" — notify both parties the signing window lapsed.
  const parties = await resolveContractParties(ctx.bookingId);
  await notifyContractEvent({ userId: parties.customerUserId, bookingId: ctx.bookingId, kind: "EXPIRED" });
  await notifyContractEvent({ userId: parties.providerUserId, bookingId: ctx.bookingId, kind: "EXPIRED" });
}

export type ExecutionHookRegistry = Partial<
  Record<ContractExecutionStatus, (ctx: ExecutionHookContext) => Promise<void>>
>;

export const EXECUTION_HOOKS: ExecutionHookRegistry = {
  CUSTOMER_SIGNED: onCustomerSigned,
  PENDING_PROVIDER: onPendingProvider,
  PROVIDER_SIGNED: onProviderSigned,
  EXECUTED: onExecuted,
  CANCELLED: onCancelled,
  EXPIRED: onExpired,
};

// Invoked by transitionExecution() after its database transaction has
// already committed. Best-effort and isolated, same as every other
// hook dispatcher in this codebase: a hook throwing must never undo or
// appear to undo an already-durably-persisted transition.
//
// The `registry` parameter defaults to EXECUTION_HOOKS and exists so
// tests can inject a stand-in registry — see the Contract/Booking
// engines' own hooks.ts for why vi.spyOn on the named exports does not
// work for this same-module-binding pattern.
export async function dispatchExecutionHook(
  ctx: ExecutionHookContext,
  registry: ExecutionHookRegistry = EXECUTION_HOOKS
): Promise<void> {
  const hook = registry[ctx.toStatus];
  if (!hook) return;

  try {
    await hook(ctx);
  } catch (error) {
    logger.error("contract.execution_hook_failed", {
      executionId: ctx.executionId,
      contractId: ctx.contractId,
      toStatus: ctx.toStatus,
      reason: error instanceof Error ? error.message : "unknown error",
    });
  }
}
