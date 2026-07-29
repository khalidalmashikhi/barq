import "server-only";
import { prisma } from "@/lib/db";
import { BookingContractNotFoundError } from "../lifecycle";
import { ContractExecutionAlreadyExistsError } from "./errors";
import { generateVerificationToken } from "./verification";
import { notifyContractEvent, resolveContractParties } from "./notify";

// Signature Execution Engine — Phase E.3. Starts the signing workflow
// for an already-generated contract: creates its ContractExecution row
// (PENDING_CUSTOMER — the customer signs first, per requirement #1's
// example order) with a fresh verification token and expiry deadline,
// and sends the "Contract Ready" notification (requirement #7) to the
// customer. This is the natural future call site for a contract
// reaching ISSUED (src/lib/contracts/lifecycle/hooks.ts's onIssued())
// — not wired there this phase, matching this codebase's established
// "prepare the integration, don't force the call site" pattern (Phase
// E.2 did the same for createContractFromBooking() and Booking's
// onAccepted()).

const DEFAULT_EXPIRES_IN_DAYS = 7;

export interface StartContractExecutionParams {
  contractId: string;
  expiresInDays?: number;
}

export interface StartContractExecutionResult {
  executionId: string;
  verificationToken: string;
}

export async function startContractExecution(
  params: StartContractExecutionParams
): Promise<StartContractExecutionResult> {
  const { contractId, expiresInDays = DEFAULT_EXPIRES_IN_DAYS } = params;

  const contract = await prisma.bookingContract.findUnique({
    where: { id: contractId },
    select: { id: true, bookingId: true },
  });
  if (!contract) {
    throw new BookingContractNotFoundError(contractId);
  }

  const existing = await prisma.contractExecution.findUnique({ where: { contractId }, select: { id: true } });
  if (existing) {
    throw new ContractExecutionAlreadyExistsError(contractId);
  }

  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  const execution = await prisma.contractExecution.create({
    data: { contractId, verificationToken: generateVerificationToken(), expiresAt },
  });

  const parties = await resolveContractParties(contract.bookingId);
  await notifyContractEvent({ userId: parties.customerUserId, bookingId: contract.bookingId, kind: "CONTRACT_READY" });

  return { executionId: execution.id, verificationToken: execution.verificationToken };
}
