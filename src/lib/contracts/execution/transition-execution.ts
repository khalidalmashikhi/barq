import "server-only";
import type { BookingActorType, BookingContractEventType, ContractExecutionStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { canTransition } from "./transitions";
import { dispatchExecutionHook, type ExecutionHookContext } from "./hooks";
import { ContractExecutionNotFoundError, InvalidContractExecutionTransitionError } from "./errors";

// Signature Execution Engine — Phase E.3. THE single engine every
// execution status change must pass through — mirrors
// src/lib/contracts/lifecycle/transition-contract.ts's design exactly
// (validate against the matrix, write the new status, record a
// BookingContractEvent row when this transition has one, return a hook
// context for the caller to dispatch after commit).
//
// Reuses BookingContractEvent (Phase E.2) for the audit trail rather
// than a new table — requirement #4's "Contract Execution Timeline"
// is the SAME underlying mechanism as requirement #8 (Phase E.2)'s
// "Contract History", just with new event type values (see
// schema.prisma's BookingContractEventType). getContractHistory()
// (Phase E.2, untouched) already returns these correctly, ordered by
// time, with no changes needed.

const EVENT_TYPE_FOR_STATUS: Record<ContractExecutionStatus, BookingContractEventType | null> = {
  PENDING_CUSTOMER: null, // set at creation by startContractExecution(), not a transition
  CUSTOMER_SIGNED: "CUSTOMER_SIGNED",
  PENDING_PROVIDER: null, // an automatic consequence of CUSTOMER_SIGNED, not its own timeline entry
  PROVIDER_SIGNED: "PROVIDER_SIGNED",
  EXECUTED: "EXECUTED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
};

export interface TransitionExecutionParams {
  executionId: string;
  toStatus: ContractExecutionStatus;
  actorType: BookingActorType;
  actorId?: string;
  note?: string;
}

type DbClient = typeof prisma | Prisma.TransactionClient;

export async function transitionExecution(
  params: TransitionExecutionParams,
  db: DbClient = prisma
): Promise<ExecutionHookContext> {
  const { executionId, toStatus, actorType, actorId, note } = params;

  const execution = await db.contractExecution.findUnique({
    where: { id: executionId },
    select: { id: true, contractId: true, status: true, contract: { select: { bookingId: true } } },
  });

  if (!execution) {
    throw new ContractExecutionNotFoundError(executionId);
  }

  if (!canTransition(execution.status, toStatus)) {
    throw new InvalidContractExecutionTransitionError(execution.status, toStatus);
  }

  await db.contractExecution.update({
    where: { id: executionId },
    data: { status: toStatus },
  });

  const eventType = EVENT_TYPE_FOR_STATUS[toStatus];
  if (eventType) {
    await db.bookingContractEvent.create({
      data: { contractId: execution.contractId, eventType, actorType, actorId: actorId ?? null, note: note ?? null },
    });

    // Requirement #8 (Audit Logging): Signed/Executed/Cancelled (and
    // Expired) all flow through here — one structured log line per
    // transition, contract/execution IDs and actor role only, never
    // the contract's own `content`/terms.
    logger.info("contract.execution_transitioned", {
      executionId,
      contractId: execution.contractId,
      eventType,
      actorType,
    });
  }

  return {
    executionId,
    contractId: execution.contractId,
    bookingId: execution.contract.bookingId,
    fromStatus: execution.status,
    toStatus,
  };
}

// Convenience wrapper for callers with no existing transaction: opens
// its own transaction, and only fires the lifecycle hook after that
// transaction has actually committed. Mirrors
// transitionContractAndFireHooks() exactly.
export async function transitionExecutionAndFireHooks(
  params: TransitionExecutionParams
): Promise<ExecutionHookContext> {
  const ctx = await prisma.$transaction((tx) => transitionExecution(params, tx));
  await dispatchExecutionHook(ctx);
  return ctx;
}
