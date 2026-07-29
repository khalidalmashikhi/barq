import "server-only";
import type { ContractExecutionStatus } from "@prisma/client";

// Signature Execution Engine — Phase E.3 (Electronic Signature &
// Contract Execution). Mirrors src/lib/contracts/lifecycle/states.ts's
// role exactly, for the same reason: one canonical list of states and
// which are terminal. This is a SEPARATE state machine from
// BookingContractStatus — it tracks the signing workflow specifically,
// not the contract's own DRAFT/GENERATED/ISSUED/ACTIVE/... lifecycle
// (untouched this phase — see transitions.ts's own comment).

export const CONTRACT_EXECUTION_STATUSES: readonly ContractExecutionStatus[] = [
  "PENDING_CUSTOMER",
  "CUSTOMER_SIGNED",
  "PENDING_PROVIDER",
  "PROVIDER_SIGNED",
  "EXECUTED",
  "CANCELLED",
  "EXPIRED",
];

export const TERMINAL_CONTRACT_EXECUTION_STATUSES: readonly ContractExecutionStatus[] = [
  "EXECUTED",
  "CANCELLED",
  "EXPIRED",
];

export function isTerminalContractExecutionStatus(status: ContractExecutionStatus): boolean {
  return TERMINAL_CONTRACT_EXECUTION_STATUSES.includes(status);
}
