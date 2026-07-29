import "server-only";
import type { BookingActorType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { BookingContractNotFoundError } from "./lifecycle";

// Contract History — Phase E.2, requirement #8. "Downloaded" is not a
// status transition — a contract can be downloaded any number of times
// without its status ever changing — so this is a standalone recorder,
// not routed through transitionContract() (which only exists for
// actual status changes).

export interface RecordContractDownloadedParams {
  contractId: string;
  actorType: BookingActorType;
  actorId?: string;
}

export async function recordContractDownloaded(params: RecordContractDownloadedParams): Promise<void> {
  const { contractId, actorType, actorId } = params;

  const contract = await prisma.bookingContract.findUnique({ where: { id: contractId }, select: { id: true } });
  if (!contract) {
    throw new BookingContractNotFoundError(contractId);
  }

  await prisma.bookingContractEvent.create({
    data: { contractId, eventType: "DOWNLOADED", actorType, actorId: actorId ?? null },
  });
}
