import { UserStatus } from "@prisma/client";
import { isSyntheticAuthEmail } from "./linked-email";

// AUTH-IDENTITY-CONVERGENCE-1 — the PURE policy layer for identity convergence
// (survivor determination + eligibility). No I/O, no "use server", no side effects,
// so it is exhaustively unit-testable in isolation. The server actions in
// identity-convergence.ts load the two IdentitySide snapshots and apply this policy
// both before sending the proof OTP and again, transactionally, before mutating.

/** A fully-loaded snapshot of one identity (domain User + bridged AuthUser + the
 *  signals that decide eligibility). Pure data. */
export type IdentitySide = {
  userId: string;
  authUserId: string;
  status: UserStatus;
  createdAt: Date;
  userPhone: string | null;
  authEmail: string | null;
  authEmailVerified: boolean;
  authPhone: string | null;
  authPhoneVerified: boolean;
  hasPrivilege: boolean; // Provider / Staff / Admin
  hasCustomer: boolean;
  customerId: string | null;
  hasMeaningfulHistory: boolean;
};

export type Eligibility =
  | { eligible: true; survivor: IdentitySide; loser: IdentitySide }
  | { eligible: false; reason: "PRIVILEGE" | "BOTH_HISTORY" | "NOT_CUSTOMER" | "SAME_IDENTITY" };

/** A real, verified, non-synthetic login email is present. */
export function hasRealVerifiedEmail(side: IdentitySide): boolean {
  return (
    side.authEmailVerified &&
    side.authEmail !== null &&
    side.authEmail.trim() !== "" &&
    !isSyntheticAuthEmail(side.authEmail)
  );
}

/**
 * Deterministic survivor + eligibility. Blocks on ANY privileged profile, a
 * non-Customer identity, or two identities that both hold meaningful history (safe
 * re-parenting cannot be proven). Survivor = the sole history-holder, else the older
 * account — NEVER "whichever session is current".
 */
export function assessEligibility(current: IdentitySide, owner: IdentitySide): Eligibility {
  if (current.userId === owner.userId) return { eligible: false, reason: "SAME_IDENTITY" };
  if (current.hasPrivilege || owner.hasPrivilege) return { eligible: false, reason: "PRIVILEGE" };
  if (!current.hasCustomer || !owner.hasCustomer) return { eligible: false, reason: "NOT_CUSTOMER" };
  if (current.hasMeaningfulHistory && owner.hasMeaningfulHistory) return { eligible: false, reason: "BOTH_HISTORY" };

  let survivor: IdentitySide;
  let loser: IdentitySide;
  if (owner.hasMeaningfulHistory) {
    survivor = owner;
    loser = current;
  } else if (current.hasMeaningfulHistory) {
    survivor = current;
    loser = owner;
  } else {
    // Neither has history → the older identity survives (a stable canonical identity),
    // NOT whichever session happens to be current.
    if (owner.createdAt.getTime() <= current.createdAt.getTime()) {
      survivor = owner;
      loser = current;
    } else {
      survivor = current;
      loser = owner;
    }
  }
  return { eligible: true, survivor, loser };
}
