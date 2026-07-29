import "server-only";
import type { ContractExecutionStatus } from "@prisma/client";

// Signature Execution Engine — Phase E.3. The one centralized
// transition matrix for ContractExecutionStatus — mirrors
// src/lib/contracts/lifecycle/transitions.ts's design exactly.
//
// PENDING_CUSTOMER ──► CUSTOMER_SIGNED ──► PENDING_PROVIDER ──► PROVIDER_SIGNED ──► EXECUTED
//        │                                       │
//        └──────────────► CANCELLED ◄────────────┘
//        └──────────────► EXPIRED    ◄────────────┘
//
// CUSTOMER_SIGNED -> PENDING_PROVIDER and PROVIDER_SIGNED -> EXECUTED
// are each fired as part of ONE combined signContract() operation (see
// sign-contract.ts) — "just signed" and "now waiting on the next
// party" happen together, matching requirement #1's own sequential
// example exactly (four distinct states in a row, not a shortcut).
// Neither X_SIGNED state has a CANCELLED/EXPIRED edge: by the time a
// signature is recorded, cancelling or expiring that specific signing
// step no longer makes sense — only the two PENDING_* waiting states
// can be cancelled or expire.
//
// This is genuinely NOT src/lib/contracts/lifecycle/transitions.ts —
// that file (the Contract Engine's own DRAFT/GENERATED/ISSUED/ACTIVE/...
// matrix) is completely untouched this phase. This is a new, parallel
// matrix for a new, parallel concept.

const TRANSITIONS: Record<ContractExecutionStatus, readonly ContractExecutionStatus[]> = {
  PENDING_CUSTOMER: ["CUSTOMER_SIGNED", "CANCELLED", "EXPIRED"],
  CUSTOMER_SIGNED: ["PENDING_PROVIDER"],
  PENDING_PROVIDER: ["PROVIDER_SIGNED", "CANCELLED", "EXPIRED"],
  PROVIDER_SIGNED: ["EXECUTED"],
  EXECUTED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export function getAllowedNextStatuses(from: ContractExecutionStatus): readonly ContractExecutionStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: ContractExecutionStatus, to: ContractExecutionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
