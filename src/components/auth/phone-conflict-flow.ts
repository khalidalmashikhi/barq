import type { ConvergenceAssessmentStatus } from "@/lib/auth/identity-convergence";

// AUTH-IDENTITY-CONVERGENCE-1 (conflict-choice UX) — the PURE, testable state logic
// behind AddPhoneButton's conflict handling. When an entered phone belongs to another
// BARQ identity, the customer is offered THREE choices — verify ownership and converge,
// use a different phone number, or cancel — and no OTP is sent until they pick the
// first one. This module owns the two decisions that must be provably correct (which
// step a conflict assessment leads to, and that "use a different number" fully clears
// any pending phone/convergence/proof state); the .tsx stays a thin shell.

export type AddPhoneStep = "idle" | "phone" | "code" | "convergeChoice" | "convergeCode" | "converged" | "support";

/**
 * The cleared text state applied by "use a different phone number" (and cancel): every
 * pending phone / convergence / OTP-proof value is dropped so no ACCOUNT_LINK_CONFLICT
 * or convergence state is ever retained into the next attempt. The selected Country is
 * reset by the caller (it holds that object); everything textual is cleared here.
 */
export interface ClearedPhoneEntry {
  nationalNumber: "";
  submittedPhone: "";
  otp: "";
  error: null;
}

export function clearedPhoneEntry(): ClearedPhoneEntry {
  return { nationalNumber: "", submittedPhone: "", otp: "", error: null };
}

/** The dashboard message keys a conflict decision can surface (both already exist). */
export type ConflictErrorKey = "addPhoneErrorInvalid" | "addPhoneErrorGeneric";

export type ConflictDecision =
  | { kind: "step"; step: Extract<AddPhoneStep, "convergeChoice" | "support"> }
  | { kind: "error"; errorKey: ConflictErrorKey };

/**
 * Map the read-only conflict assessment to the next UI step, or a dashboard error key.
 * CONVERGENCE_AVAILABLE opens the three-choice screen; an owned-but-unsafe result shows
 * the generic support message; anything else surfaces a non-leaking error.
 */
export function decideAfterConflict(status: ConvergenceAssessmentStatus): ConflictDecision {
  switch (status) {
    case "CONVERGENCE_AVAILABLE":
      return { kind: "step", step: "convergeChoice" };
    case "SUPPORT_REQUIRED":
      return { kind: "step", step: "support" };
    case "INVALID_PHONE":
      return { kind: "error", errorKey: "addPhoneErrorInvalid" };
    default:
      return { kind: "error", errorKey: "addPhoneErrorGeneric" };
  }
}
