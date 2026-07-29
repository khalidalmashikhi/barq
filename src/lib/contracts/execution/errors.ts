import "server-only";
import type { BookingActorType, ContractExecutionStatus } from "@prisma/client";

// Signature Execution Engine — Phase E.3. Distinct, typed errors —
// mirrors src/lib/contracts/lifecycle/errors.ts's design.

export class ContractExecutionNotFoundError extends Error {
  constructor(identifier: string) {
    super(`ContractExecution not found: ${identifier}`);
    this.name = "ContractExecutionNotFoundError";
  }
}

export class ContractExecutionAlreadyExistsError extends Error {
  constructor(contractId: string) {
    super(`ContractExecution already exists for contract: ${contractId}`);
    this.name = "ContractExecutionAlreadyExistsError";
  }
}

export class InvalidContractExecutionTransitionError extends Error {
  readonly from: ContractExecutionStatus;
  readonly to: ContractExecutionStatus;

  constructor(from: ContractExecutionStatus, to: ContractExecutionStatus) {
    super(`Invalid execution transition: ${from} -> ${to}`);
    this.name = "InvalidContractExecutionTransitionError";
    this.from = from;
    this.to = to;
  }
}

// Requirement #9's "invalid signing order" / "duplicate signatures":
// thrown when the execution's current status isn't the one that
// expects a signature from `signerType` right now — e.g. a customer
// attempting to sign while status is PENDING_PROVIDER (already signed
// once) or EXECUTED (workflow already finished). Distinct from
// InvalidContractExecutionTransitionError: the target status might be
// perfectly reachable in the abstract matrix, but not by THIS signer,
// right now.
export class NotPendingThisSignerError extends Error {
  readonly status: ContractExecutionStatus;
  readonly signerType: BookingActorType;

  constructor(status: ContractExecutionStatus, signerType: BookingActorType) {
    super(`Execution is not pending a signature from ${signerType} (current status: ${status})`);
    this.name = "NotPendingThisSignerError";
    this.status = status;
    this.signerType = signerType;
  }
}

// Thrown by signContract() when the execution's own deadline has
// already lapsed — a lazy check at sign-time, not an automatic
// background transition to EXPIRED (no scheduled job is built this
// phase; see docs/09-contracts/CONTRACT_EXECUTION.md's Future Work).
export class ContractExecutionExpiredError extends Error {
  constructor(executionId: string) {
    super(`ContractExecution has expired: ${executionId}`);
    this.name = "ContractExecutionExpiredError";
  }
}

// Thrown by getContractPdfForDownload() (requirement #5) — a
// DRAFT BookingContract has no `content` yet (Phase E.2), so there is
// nothing to render into a PDF.
export class ContractNotYetGeneratedError extends Error {
  constructor(contractId: string) {
    super(`BookingContract has no generated content yet: ${contractId}`);
    this.name = "ContractNotYetGeneratedError";
  }
}
