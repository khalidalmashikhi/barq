import type { LinkAssessmentStatus, LinkOfferStatus, LinkCompletion } from "@/lib/auth/provider-link-orchestration";

// AUTH-IDENTITY-CONVERGENCE-1 / AUTH-PROVIDER-LINK gate 3B — the PURE, testable state logic
// behind AddPhoneButton's conflict handling. When an entered phone belongs to another BARQ
// identity, the customer is offered THREE choices — verify ownership and link, use a different
// phone number, or cancel — and no OTP is sent until they pick the first one.
//
// Gate 3B routes this through the UNIFIED orchestration (assess/offer/complete), so an eligible
// customer convergence and an eligible provider credential link are INDISTINGUISHABLE through
// every pre-success step. The two only diverge at terminal success: a customer convergence
// stays signed in (`converged`), while a provider link retires the current identity and
// requires re-authentication (`reauth`). This module owns the decisions that must be provably
// correct (which step each result leads to, and that "use a different number" fully clears any
// pending phone / attempt / OTP state); the .tsx stays a thin shell.

export type AddPhoneStep = "idle" | "phone" | "code" | "convergeChoice" | "convergeCode" | "converged" | "reauth" | "support";

/**
 * The cleared state applied by "use a different phone number" (and cancel): every pending
 * phone / proof-attempt / OTP value is dropped so no conflict or in-flight verification state
 * is ever retained into the next attempt — in particular a consumed/expired opaque attemptId
 * can never be reused. The selected Country is reset by the caller (it holds that object).
 */
export interface ClearedPhoneEntry {
  nationalNumber: "";
  submittedPhone: "";
  attemptId: "";
  otp: "";
  error: null;
}

export function clearedPhoneEntry(): ClearedPhoneEntry {
  return { nationalNumber: "", submittedPhone: "", attemptId: "", otp: "", error: null };
}

/** The dashboard message keys a decision can surface (all already exist in every locale's dashboard.json). */
export type LinkMessageKey =
  | "addPhoneErrorInvalid"
  | "addPhoneErrorGeneric"
  | "addPhoneErrorRateLimited"
  | "addPhoneErrorUnavailable"
  | "addPhoneErrorInvalidOtp"
  | "convergeExpired";

export type FlowDecision =
  | { kind: "step"; step: Extract<AddPhoneStep, "convergeChoice" | "convergeCode" | "converged" | "reauth" | "support"> }
  | { kind: "error"; errorKey: LinkMessageKey };

/**
 * Map the read-only conflict assessment to the next UI step, or a dashboard error key.
 * LINK_AVAILABLE (customer convergence OR provider link — indistinguishable) opens the
 * three-choice screen; an owned-but-unsafe result shows the generic support message; anything
 * else surfaces a non-leaking error.
 */
export function decideAfterConflict(status: LinkAssessmentStatus): FlowDecision {
  switch (status) {
    case "LINK_AVAILABLE":
      return { kind: "step", step: "convergeChoice" };
    case "SUPPORT_REQUIRED":
      return { kind: "step", step: "support" };
    case "INVALID_PHONE":
      return { kind: "error", errorKey: "addPhoneErrorInvalid" };
    default:
      return { kind: "error", errorKey: "addPhoneErrorGeneric" };
  }
}

/**
 * Map the offer result (after explicit consent) to the next step. OWNERSHIP_VERIFICATION_REQUIRED
 * advances to OTP entry (the caller stores the returned opaque attemptId); a blocked result shows
 * generic support; rate-limit / delivery failures surface their generic messages.
 */
export function decideAfterOffer(status: LinkOfferStatus): FlowDecision {
  switch (status) {
    case "OWNERSHIP_VERIFICATION_REQUIRED":
      return { kind: "step", step: "convergeCode" };
    case "SUPPORT_REQUIRED":
      return { kind: "step", step: "support" };
    case "RATE_LIMITED":
      return { kind: "error", errorKey: "addPhoneErrorRateLimited" };
    case "OTP_DELIVERY_UNAVAILABLE":
      return { kind: "error", errorKey: "addPhoneErrorUnavailable" };
    default:
      return { kind: "error", errorKey: "addPhoneErrorGeneric" };
  }
}

/**
 * Map the completion result to the next step. A customer convergence succeeds in place
 * (`converged`, session preserved); a provider link succeeds with re-auth required (`reauth`,
 * current sessions invalidated by the transaction). Failures never reveal the route type.
 */
export function decideAfterComplete(result: LinkCompletion): FlowDecision {
  if (result.ok) {
    return { kind: "step", step: result.outcome === "LINK_COMPLETED_REAUTH_REQUIRED" ? "reauth" : "converged" };
  }
  switch (result.error) {
    case "SUPPORT_REQUIRED":
      return { kind: "step", step: "support" };
    case "INVALID_OTP":
      return { kind: "error", errorKey: "addPhoneErrorInvalidOtp" };
    case "INVALID_CHALLENGE":
      return { kind: "error", errorKey: "convergeExpired" };
    case "RATE_LIMITED":
      return { kind: "error", errorKey: "addPhoneErrorRateLimited" };
    default:
      return { kind: "error", errorKey: "addPhoneErrorGeneric" };
  }
}
