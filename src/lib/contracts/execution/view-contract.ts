import "server-only";
import type { BookingActorType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { BookingContractNotFoundError } from "../lifecycle";
import { logger } from "@/lib/logger";

// Contract Execution Timeline — Phase E.3, requirement #4. "Viewed" is
// not a status transition (a contract can be viewed any number of
// times without its status ever changing) — mirrors Phase E.2's
// recordContractDownloaded()'s own reasoning exactly, for the same
// event-log table.
//
// Requirement #8 (Audit Logging): also emits a structured log line —
// contract IDs/actor role only, never `content`/terms.

export interface RecordContractViewedParams {
  contractId: string;
  actorType: BookingActorType;
  actorId?: string;
}

export async function recordContractViewed(params: RecordContractViewedParams): Promise<void> {
  const { contractId, actorType, actorId } = params;

  const contract = await prisma.bookingContract.findUnique({ where: { id: contractId }, select: { id: true } });
  if (!contract) {
    throw new BookingContractNotFoundError(contractId);
  }

  await prisma.bookingContractEvent.create({
    data: { contractId, eventType: "VIEWED", actorType, actorId: actorId ?? null },
  });

  logger.info("contract.viewed", { contractId, actorType });
}
