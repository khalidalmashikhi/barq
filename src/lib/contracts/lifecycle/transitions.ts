import "server-only";
import type { BookingContractStatus } from "@prisma/client";

// Contract Lifecycle Engine — Phase E.2. The one centralized
// transition matrix for BookingContractStatus, mirroring
// src/lib/booking/lifecycle/transitions.ts's design exactly:
// requirement #3 ("Centralize transition rules... every status change
// must pass through one engine") from Phase E.1 applies here too, even
// though it isn't restated verbatim in this phase's own requirements.
//
// DRAFT ──► GENERATED ──► ISSUED ──► ACTIVE ──► COMPLETED
//   │            │            │          │
//   └────────────┴──► CANCELLED ◄─────────┘
//                                          └──► EXPIRED
//
// CANCELLED is reachable from every non-terminal status (a contract
// can be called off at any stage before it completes) — the direct
// analogue of Phase E.1's CANCELLED rule for Bookings. EXPIRED is
// reachable only from ACTIVE (time-based lapse of an already-active
// contract) — mirroring Phase E.1's DISPUTED being reachable only from
// post-acceptance states. All three of COMPLETED/CANCELLED/EXPIRED are
// fully terminal, exactly like Phase E.1's own regression lesson: no
// speculative resurrection edge (e.g. EXPIRED -> ACTIVE "renewal") is
// added here without a real renewal feature designing its own rule —
// see docs/09-contracts/CONTRACT_ENGINE.md's Future Work section.

const TRANSITIONS: Record<BookingContractStatus, readonly BookingContractStatus[]> = {
  DRAFT: ["GENERATED", "CANCELLED"],
  GENERATED: ["ISSUED", "CANCELLED"],
  ISSUED: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["COMPLETED", "CANCELLED", "EXPIRED"],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export function getAllowedNextStatuses(from: BookingContractStatus): readonly BookingContractStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: BookingContractStatus, to: BookingContractStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
