import "server-only";
import type { BookingContractStatus } from "@prisma/client";
import { logger } from "@/lib/logger";

// Contract Lifecycle Engine — Phase E.2. Extension points for future
// modules to attach behavior to a contract transition, mirroring
// src/lib/booking/lifecycle/hooks.ts's design and its same rationale:
// adding real behavior later is a body-only change inside the matching
// onXxx function, never a signature or call-site change.
//
// onIssued() and onActivated() are natural future homes for
// notification-sending ("your contract is ready to review" /
// "your contract is now active"). onActivated() is also a very
// plausible future home for the electronic-signature request
// (requirement #10) — once ISSUED -> ACTIVE requires a real signature
// step, that call goes here without touching transitionContract()
// or the transition matrix.

export interface ContractHookContext {
  contractId: string;
  bookingId: string;
  fromStatus: BookingContractStatus | null;
  toStatus: BookingContractStatus;
}

export async function onGenerated(ctx: ContractHookContext): Promise<void> {
  void ctx; // Future extension point: notify customer/provider content is ready.
}

export async function onIssued(ctx: ContractHookContext): Promise<void> {
  void ctx; // Future extension point: notify customer, request electronic signature.
}

export async function onActivated(ctx: ContractHookContext): Promise<void> {
  void ctx; // Future extension point: government/employer/customer approval workflow.
}

export async function onCompleted(ctx: ContractHookContext): Promise<void> {
  void ctx; // Future extension point: archival, renewal offer, etc.
}

export async function onCancelled(ctx: ContractHookContext): Promise<void> {
  void ctx; // Future extension point: notify parties, revoke QR verification.
}

export async function onExpired(ctx: ContractHookContext): Promise<void> {
  void ctx; // Future extension point: renewal offer, notify parties.
}

export type ContractHookRegistry = Partial<
  Record<BookingContractStatus, (ctx: ContractHookContext) => Promise<void>>
>;

export const CONTRACT_HOOKS: ContractHookRegistry = {
  GENERATED: onGenerated,
  ISSUED: onIssued,
  ACTIVE: onActivated,
  COMPLETED: onCompleted,
  CANCELLED: onCancelled,
  EXPIRED: onExpired,
};

// Invoked by transitionContract() after its database transaction has
// already committed. Best-effort and isolated, same as the Booking
// engine's dispatcher: a hook throwing must never undo or appear to
// undo an already-durably-persisted transition.
//
// The `registry` parameter defaults to CONTRACT_HOOKS and exists so
// tests can inject a stand-in registry — see hooks.ts's Booking
// -engine counterpart for why vi.spyOn on the named exports does not
// work for this same-module-binding pattern.
export async function dispatchContractHook(
  ctx: ContractHookContext,
  registry: ContractHookRegistry = CONTRACT_HOOKS
): Promise<void> {
  const hook = registry[ctx.toStatus];
  if (!hook) return;

  try {
    await hook(ctx);
  } catch (error) {
    logger.error("contract.lifecycle_hook_failed", {
      contractId: ctx.contractId,
      toStatus: ctx.toStatus,
      reason: error instanceof Error ? error.message : "unknown error",
    });
  }
}
