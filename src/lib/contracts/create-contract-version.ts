import "server-only";
import type { BookingActorType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { BookingContractNotFoundError, ArchivedBookingContractError } from "./lifecycle";
import { generateContractNumber } from "./contract-number";

// Contract Versioning & Archive — Phase E.2, requirements #5 and #9.
//
// "Future edits must never overwrite history" / "Contracts must remain
// immutable after generation... Future versions create new revisions.
// Never overwrite previous contracts." — this function is the ONLY
// way a contract's content is ever effectively "changed": it creates a
// brand-new BookingContract row (its own fresh contract number, its
// own DRAFT status, `version` incremented, `supersedesContractId`
// pointing back), and marks the previous row `archivedAt` — it never
// runs an UPDATE against the previous row's `content` or `status`.
// Mirrors the pre-existing `Contract` model's own supersession
// self-relation pattern (schema.prisma) rather than inventing a new
// versioning idiom.

export interface CreateContractRevisionParams {
  previousContractId: string;
  actorType: BookingActorType;
  actorId?: string;
  reason?: string;
}

export interface CreateContractRevisionResult {
  contractId: string;
  contractNumber: string;
  version: number;
}

export async function createContractRevision(
  params: CreateContractRevisionParams
): Promise<CreateContractRevisionResult> {
  const { previousContractId, actorType, actorId, reason } = params;

  const previous = await prisma.bookingContract.findUnique({ where: { id: previousContractId } });
  if (!previous) {
    throw new BookingContractNotFoundError(previousContractId);
  }
  if (previous.archivedAt) {
    // Revising an already-archived contract would create a fork in the
    // supersession chain rather than a linear history — only the
    // current, non-archived version may be revised.
    throw new ArchivedBookingContractError(previousContractId);
  }

  const contractNumber = await generateContractNumber();

  const newContract = await prisma.$transaction(async (tx) => {
    const created = await tx.bookingContract.create({
      data: {
        bookingId: previous.bookingId,
        contractNumber,
        templateKey: previous.templateKey,
        templateVersion: previous.templateVersion,
        version: previous.version + 1,
        supersedesContractId: previous.id,
      },
    });

    await tx.bookingContractEvent.create({
      data: {
        contractId: created.id,
        eventType: "CREATED",
        actorType,
        actorId: actorId ?? null,
        note: reason ?? null,
      },
    });

    await tx.bookingContract.update({
      where: { id: previous.id },
      data: { archivedAt: new Date() },
    });

    await tx.bookingContractEvent.create({
      data: { contractId: previous.id, eventType: "ARCHIVED", actorType, actorId: actorId ?? null, note: reason ?? null },
    });

    return created;
  });

  return { contractId: newContract.id, contractNumber: newContract.contractNumber, version: newContract.version };
}
