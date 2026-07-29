import "server-only";
import { prisma } from "@/lib/db";
import { transitionContractAndFireHooks } from "../lifecycle";
import { transitionExecution } from "./transition-execution";
import { dispatchExecutionHook } from "./hooks";
import { ContractExecutionNotFoundError, NotPendingThisSignerError, ContractExecutionExpiredError } from "./errors";
import { getSignatureProvider, type SignatureProviderKey } from "./signature-providers/get-signature-provider";
import { resolveSignatureIp } from "./ip-config";
import type { ContractExecutionStatus } from "@prisma/client";

// Signature Execution Engine — Phase E.3. The core signing action.
//
// Only CUSTOMER and PROVIDER can sign in this two-party model — SYSTEM
// and ADMIN (valid BookingActorType values elsewhere) are deliberately
// excluded from this function's own parameter type.
//
// "Invalid signing order" and "duplicate signatures" (requirement #9's
// own named test scenarios) are BOTH caught by the same one check:
// the execution's current status must be the exact PENDING_* status
// that expects a signature from `signerType` right now. A provider
// signing first, or a customer signing twice, both fail that check —
// no separate "is this a duplicate" logic is needed.
//
// Signing is modeled as ONE atomic operation spanning two lifecycle
// transitions (PENDING_X -> X_SIGNED -> next), matching requirement
// #1's own sequential example (four distinct states, not a shortcut) —
// see transitions.ts's own comment. Both transitions, plus the new
// ContractSignature row, are written in a single database transaction;
// both hooks fire only after it commits.
//
// Reaching EXECUTED cascades into the Contract Engine (Phase E.2,
// completely untouched) via its own, already-public
// transitionContractAndFireHooks() — using the existing engine's API,
// not bypassing or duplicating it. This is the concrete fulfillment of
// what Phase E.2's own onActivated()/onIssued() comments anticipated.

export type SigningActorType = "CUSTOMER" | "PROVIDER";

export interface SignContractParams {
  contractId: string;
  signerType: SigningActorType;
  signerId?: string;
  ipAddress?: string;
  userAgent?: string;
  providerKey?: SignatureProviderKey;
}

export interface SignContractResult {
  signatureId: string;
  executionStatus: ContractExecutionStatus;
}

const EXPECTED_STATUS_FOR_SIGNER: Record<SigningActorType, ContractExecutionStatus> = {
  CUSTOMER: "PENDING_CUSTOMER",
  PROVIDER: "PENDING_PROVIDER",
};

const SIGNED_STATUS_FOR_SIGNER: Record<SigningActorType, ContractExecutionStatus> = {
  CUSTOMER: "CUSTOMER_SIGNED",
  PROVIDER: "PROVIDER_SIGNED",
};

const NEXT_STATUS_AFTER_SIGNING: Record<SigningActorType, ContractExecutionStatus> = {
  CUSTOMER: "PENDING_PROVIDER",
  PROVIDER: "EXECUTED",
};

export async function signContract(params: SignContractParams): Promise<SignContractResult> {
  const { contractId, signerType, signerId, ipAddress, userAgent, providerKey = "INTERNAL" } = params;

  const execution = await prisma.contractExecution.findUnique({ where: { contractId } });
  if (!execution) {
    throw new ContractExecutionNotFoundError(contractId);
  }

  const expectedStatus = EXPECTED_STATUS_FOR_SIGNER[signerType];
  if (execution.status !== expectedStatus) {
    throw new NotPendingThisSignerError(execution.status, signerType);
  }

  if (execution.expiresAt && execution.expiresAt.getTime() < Date.now()) {
    throw new ContractExecutionExpiredError(execution.id);
  }

  const provider = getSignatureProvider(providerKey);
  const signResult = await provider.sign({ contractId, signerType, signerId, ipAddress, userAgent });
  const resolvedIp = resolveSignatureIp(ipAddress);

  const signedStatus = SIGNED_STATUS_FOR_SIGNER[signerType];
  const nextStatus = NEXT_STATUS_AFTER_SIGNING[signerType];

  const { signatureId, signedCtx, nextCtx } = await prisma.$transaction(async (tx) => {
    const signature = await tx.contractSignature.create({
      data: {
        contractId,
        executionId: execution.id,
        signerType,
        signerId: signerId ?? null,
        signedAt: signResult.signedAt,
        ipAddress: resolvedIp,
        userAgent: userAgent ?? null,
        method: provider.method,
        providerKey: provider.key,
        providerReference: signResult.providerReference ?? null,
      },
    });

    const signedCtx = await transitionExecution(
      { executionId: execution.id, toStatus: signedStatus, actorType: signerType, actorId: signerId },
      tx
    );
    const nextCtx = await transitionExecution(
      { executionId: execution.id, toStatus: nextStatus, actorType: signerType, actorId: signerId },
      tx
    );

    return { signatureId: signature.id, signedCtx, nextCtx };
  });

  await dispatchExecutionHook(signedCtx);
  await dispatchExecutionHook(nextCtx);

  if (nextStatus === "EXECUTED") {
    // Cascades into the Contract Engine's OWN, untouched transition
    // matrix (ISSUED -> ACTIVE is already valid there — Phase E.2)
    // via its already-public function — not a new capability added to
    // that engine, just a caller of it.
    await transitionContractAndFireHooks({ contractId, toStatus: "ACTIVE", actorType: signerType, actorId: signerId });
  }

  return { signatureId, executionStatus: nextCtx.toStatus };
}
