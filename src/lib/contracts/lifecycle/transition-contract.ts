import "server-only";
import type { BookingActorType, BookingContractEventType, BookingContractStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canTransition } from "./transitions";
import { dispatchContractHook, type ContractHookContext } from "./hooks";
import { BookingContractNotFoundError, InvalidBookingContractTransitionError, ArchivedBookingContractError } from "./errors";

// Contract Lifecycle Engine — Phase E.2. THE single engine every
// contract status change must pass through — mirrors
// src/lib/booking/lifecycle/transition-booking.ts's design (validate
// against the matrix, write the new status, record one event row,
// return a hook context for the caller to dispatch after commit).
//
// Additionally guards against writing to an ARCHIVED contract
// (requirement #9's immutability rule) — Bookings have no equivalent
// concept, so this check has no counterpart in the Booking engine.

const EVENT_TYPE_FOR_STATUS: Record<BookingContractStatus, BookingContractEventType | null> = {
  DRAFT: null, // creation is handled by createContractFromBooking(), not a transition
  GENERATED: "GENERATED",
  ISSUED: "ISSUED",
  ACTIVE: "ACTIVATED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
};

export interface TransitionContractParams {
  contractId: string;
  toStatus: BookingContractStatus;
  actorType: BookingActorType;
  actorId?: string;
  note?: string;
}

type DbClient = typeof prisma | Prisma.TransactionClient;

export async function transitionContract(
  params: TransitionContractParams,
  db: DbClient = prisma
): Promise<ContractHookContext> {
  const { contractId, toStatus, actorType, actorId, note } = params;

  const contract = await db.bookingContract.findUnique({
    where: { id: contractId },
    select: { id: true, bookingId: true, status: true, archivedAt: true },
  });

  if (!contract) {
    throw new BookingContractNotFoundError(contractId);
  }

  if (contract.archivedAt) {
    throw new ArchivedBookingContractError(contractId);
  }

  if (!canTransition(contract.status, toStatus)) {
    throw new InvalidBookingContractTransitionError(contract.status, toStatus);
  }

  await db.bookingContract.update({
    where: { id: contractId },
    data: { status: toStatus },
  });

  const eventType = EVENT_TYPE_FOR_STATUS[toStatus];
  if (eventType) {
    await db.bookingContractEvent.create({
      data: { contractId, eventType, actorType, actorId: actorId ?? null, note: note ?? null },
    });
  }

  return {
    contractId,
    bookingId: contract.bookingId,
    fromStatus: contract.status,
    toStatus,
  };
}

// Convenience wrapper for callers with no existing transaction: opens
// its own transaction, and only fires the lifecycle hook after that
// transaction has actually committed. Mirrors
// transitionBookingAndFireHooks() exactly.
export async function transitionContractAndFireHooks(
  params: TransitionContractParams
): Promise<ContractHookContext> {
  const ctx = await prisma.$transaction((tx) => transitionContract(params, tx));
  await dispatchContractHook(ctx);
  return ctx;
}
