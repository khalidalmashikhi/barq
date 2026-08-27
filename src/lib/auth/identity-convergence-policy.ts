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
 * Whether a side can be the SURVIVING canonical customer. It must hold a Customer
 * profile; a current-architecture AuthUser bridge is implied (loadSide only yields a
 * side when one is present). A legacy phone identity that predates the Customer-profile
 * model has no Customer, so it can only ever be the LOSER, never the survivor.
 */
function canSurvive(side: IdentitySide): boolean {
  return side.hasCustomer;
}

/**
 * Deterministic survivor + eligibility. Blocks on ANY privileged profile (either side),
 * on NEITHER side being a full customer (no valid canonical identity to keep), and on
 * two full customers that both hold meaningful history (safe re-parenting cannot be
 * proven). Otherwise the survivor is the full customer; when both are full customers it
 * is the sole history-holder, else the older account — NEVER "whichever session is
 * current".
 *
 * AUTH-LEGACY-CONVERGENCE-1 — a legacy phone-first identity (verified phone, but no
 * Customer because it predates the Customer-profile/bootstrap model) is no longer
 * rejected outright: with no Customer it has no transactional history to strand (every
 * booking/wallet/contract/review/ticket hangs off a Customer), so it is a SAFE loser
 * behind the full-customer survivor. This does not relax privilege or history safety.
 */
export function assessEligibility(current: IdentitySide, owner: IdentitySide): Eligibility {
  if (current.userId === owner.userId) return { eligible: false, reason: "SAME_IDENTITY" };
  if (current.hasPrivilege || owner.hasPrivilege) return { eligible: false, reason: "PRIVILEGE" };

  const currentCanSurvive = canSurvive(current);
  const ownerCanSurvive = canSurvive(owner);
  // A single Customer-less side becomes the loser; only NEITHER being a full customer
  // (no identity that can survive) blocks.
  if (!currentCanSurvive && !ownerCanSurvive) return { eligible: false, reason: "NOT_CUSTOMER" };

  let survivor: IdentitySide;
  let loser: IdentitySide;
  if (currentCanSurvive && !ownerCanSurvive) {
    // Legacy owner (no Customer) → loser; the current full customer survives.
    survivor = current;
    loser = owner;
  } else if (ownerCanSurvive && !currentCanSurvive) {
    survivor = owner;
    loser = current;
  } else {
    // Both are full customers → the established rule.
    if (current.hasMeaningfulHistory && owner.hasMeaningfulHistory) return { eligible: false, reason: "BOTH_HISTORY" };
    if (owner.hasMeaningfulHistory) {
      survivor = owner;
      loser = current;
    } else if (current.hasMeaningfulHistory) {
      survivor = current;
      loser = owner;
    } else if (owner.createdAt.getTime() <= current.createdAt.getTime()) {
      // Neither has history → the older identity survives, NOT the current session.
      survivor = owner;
      loser = current;
    } else {
      survivor = current;
      loser = owner;
    }
  }

  // Fail-closed backstop: the loser must carry no meaningful transactional history that
  // deactivation would strand. A no-Customer loser has none by construction; a
  // full-customer loser only reaches here when it has none.
  if (loser.hasMeaningfulHistory) return { eligible: false, reason: "BOTH_HISTORY" };

  return { eligible: true, survivor, loser };
}
