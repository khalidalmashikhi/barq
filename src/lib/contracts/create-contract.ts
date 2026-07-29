import "server-only";
import type { BookingActorType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { BookingNotFoundError } from "@/lib/booking/lifecycle";
import { generateContractNumber } from "./contract-number";
import { getContractTemplate, type ContractTemplateKey } from "./templates/get-contract-template";

// Booking Integration — Phase E.2, requirement #6.
//
// *** THIS FUNCTION IS THE PREPARED INTEGRATION POINT — IT IS NOT
// WIRED TO ANYTHING YET. *** Requirement #6 says "BookingAccepted ->
// Contract Generated. Only prepare the integration. Do NOT
// automatically generate contracts yet." — this phase's own Critical
// Rules also say "DO NOT: Change Booking Lifecycle." Both are
// satisfied the same way: this function exists, is fully tested, and
// is exactly what a future call from
// src/lib/booking/lifecycle/hooks.ts's onAccepted() would invoke —
// but nothing calls it yet, and onAccepted() itself is untouched
// (still its Phase E.1 empty stub). Wiring the two together is a
// one-line change in a future phase, not a redesign of either engine.
//
// Creates the contract's row in DRAFT — no content yet (that's
// generateContractContent()'s job) — with its permanent contract
// number and template reference already assigned.

export interface CreateContractFromBookingParams {
  bookingId: string;
  templateKey: ContractTemplateKey;
  actorType: BookingActorType;
  actorId?: string;
}

export interface CreateContractFromBookingResult {
  contractId: string;
  contractNumber: string;
}

export async function createContractFromBooking(
  params: CreateContractFromBookingParams
): Promise<CreateContractFromBookingResult> {
  const { bookingId, templateKey, actorType, actorId } = params;

  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { id: true } });
  if (!booking) {
    throw new BookingNotFoundError(bookingId);
  }

  const template = getContractTemplate(templateKey);
  const contractNumber = await generateContractNumber();

  const contract = await prisma.$transaction(async (tx) => {
    const created = await tx.bookingContract.create({
      data: {
        bookingId,
        contractNumber,
        templateKey,
        templateVersion: template.version,
      },
    });

    await tx.bookingContractEvent.create({
      data: { contractId: created.id, eventType: "CREATED", actorType, actorId: actorId ?? null },
    });

    return created;
  });

  return { contractId: contract.id, contractNumber: contract.contractNumber };
}
