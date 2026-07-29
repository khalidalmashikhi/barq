import "server-only";
import type { BookingActorType, ContractExecutionStatus, ContractSignatureMethod } from "@prisma/client";
import { prisma } from "@/lib/db";

// Signature Execution Engine — Phase E.3. A read-only status/summary
// query — returns null (not a thrown error) when no execution has
// been started for this contract yet, since that's a normal, expected
// state (mirrors get-booking-detail.ts's own null-for-not-found
// convention), not an error condition.

export interface ExecutionSignatureSummary {
  signerType: BookingActorType;
  signedAt: Date;
  method: ContractSignatureMethod;
}

export interface ContractExecutionStatusSummary {
  executionId: string;
  status: ContractExecutionStatus;
  expiresAt: Date | null;
  signatures: ExecutionSignatureSummary[];
}

export async function getContractExecutionStatus(contractId: string): Promise<ContractExecutionStatusSummary | null> {
  const execution = await prisma.contractExecution.findUnique({
    where: { contractId },
    include: {
      signatures: {
        orderBy: { signedAt: "asc" },
        select: { signerType: true, signedAt: true, method: true },
      },
    },
  });

  if (!execution) return null;

  return {
    executionId: execution.id,
    status: execution.status,
    expiresAt: execution.expiresAt,
    signatures: execution.signatures,
  };
}
