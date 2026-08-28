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
  hasPrivilege: boolean; // Provider / Staff / Admin (any) — the existing customer-convergence guard
  // AUTH-PROVIDER-LINK gate 1 — the privilege split. `hasProvider` is an ordinary
  // marketplace role a human may legitimately hold alongside being a customer;
  // `hasStaffOrAdmin` is an internal privileged role that must never be linked/converged
  // via self-service. (hasPrivilege === hasProvider || hasStaffOrAdmin.)
  hasProvider: boolean;
  hasStaffOrAdmin: boolean;
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

// ─── AUTH-PROVIDER-LINK gate 1 — classify convergence vs provider credential link ───
//
// A DISTINCT server-side classification layered OVER the unchanged customer-convergence
// eligibility. It never mutates; it only decides which operation (if any) is safe:
//   • CUSTOMER_CONVERGENCE   — the existing operation (full customer survives).
//   • PROVIDER_CREDENTIAL_LINK — a legitimate person who is a Provider on an existing
//     phone identity (A) adds a newly-verified email from an ordinary, zero-history,
//     non-privileged identity (B). The PROVIDER A is the deterministic survivor; no
//     privilege ever moves; B contributes only its email and is retired later. (The
//     transfer/OTP/UX are NOT part of this gate — this only assesses eligibility.)
//   • SUPPORT_REQUIRED       — everything else, incl. ANY Staff/Admin on either side.
//
// It does NOT weaken assessEligibility or hasPrivilege: customer convergence still
// rejects every privileged identity exactly as before.

export type LinkBlockReason =
  | "STAFF_ADMIN_BLOCKED" // an internal privileged role on either side — never self-service
  | "CURRENT_PRIVILEGED" // the current identity B itself holds a privileged profile
  | "CURRENT_HISTORY_UNSAFE" // B carries transactional history that cannot be safely retired
  | "OWNER_NOT_LINKABLE" // a provider owner, but B is otherwise ineligible (e.g. no real email)
  | "BOTH_HISTORY" // two full customers both hold meaningful history (customer-path reason)
  | "NOT_CUSTOMER" // neither side is a full customer (customer-path reason)
  | "SAME_IDENTITY"
  | "NOT_ELIGIBLE"; // ineligible for any operation, no more specific reason

export type ConvergenceClassification =
  | { kind: "CUSTOMER_CONVERGENCE"; survivor: IdentitySide; loser: IdentitySide }
  | { kind: "PROVIDER_CREDENTIAL_LINK"; survivor: IdentitySide; loser: IdentitySide }
  | { kind: "SUPPORT_REQUIRED"; reason: LinkBlockReason };

/**
 * Whether an identity is safe to RETIRE as the loser of a link/convergence: it must be
 * an ordinary, non-privileged identity with no meaningful transactional history to
 * strand. Fail-closed — any privileged profile or meaningful history makes it unsafe.
 */
export function isSafeToRetire(side: IdentitySide): boolean {
  return !side.hasPrivilege && !side.hasMeaningfulHistory;
}

export function classifyConvergence(current: IdentitySide, owner: IdentitySide): ConvergenceClassification {
  // Staff/Admin on EITHER side → never self-service (blocks before anything else).
  if (current.hasStaffOrAdmin || owner.hasStaffOrAdmin) return { kind: "SUPPORT_REQUIRED", reason: "STAFF_ADMIN_BLOCKED" };

  // Existing customer-convergence path — evaluated and returned UNCHANGED.
  const customer = assessEligibility(current, owner);
  if (customer.eligible) return { kind: "CUSTOMER_CONVERGENCE", survivor: customer.survivor, loser: customer.loser };

  // Provider credential linking — the provider owner survives; B contributes its email.
  // Eligible only when the owner is a Provider (and, per the guard above, NOT Staff/Admin),
  // the current identity B is non-privileged, carries a real verified email, and is safe
  // to retire (zero meaningful history). A != B and consistent topology are already proven
  // by the caller (both sides loaded).
  if (owner.hasProvider && !current.hasPrivilege && hasRealVerifiedEmail(current) && isSafeToRetire(current)) {
    return { kind: "PROVIDER_CREDENTIAL_LINK", survivor: owner, loser: current };
  }

  // Otherwise support — surface the most precise internal reason.
  if (owner.hasProvider) {
    // A provider owner that could not be linked: pinpoint why B is unsafe.
    const reason: LinkBlockReason = current.hasPrivilege
      ? "CURRENT_PRIVILEGED"
      : current.hasMeaningfulHistory
        ? "CURRENT_HISTORY_UNSAFE"
        : "OWNER_NOT_LINKABLE"; // e.g. B has no real verified email to link
    return { kind: "SUPPORT_REQUIRED", reason };
  }
  // Non-provider ineligible pair → carry through the customer-convergence reason.
  const CUSTOMER_REASON: Record<string, LinkBlockReason> = {
    PRIVILEGE: "CURRENT_PRIVILEGED",
    BOTH_HISTORY: "BOTH_HISTORY",
    NOT_CUSTOMER: "NOT_CUSTOMER",
    SAME_IDENTITY: "SAME_IDENTITY",
  };
  return { kind: "SUPPORT_REQUIRED", reason: CUSTOMER_REASON[customer.reason] ?? "NOT_ELIGIBLE" };
}
