import type { ReviewModerationState } from "@prisma/client";

// REVIEW TRUST & SAFETY — the ONE explicit moderation transition policy. PURE and isomorphic (no
// server-only, no I/O), so the server action and the admin UI read the SAME rules and it is
// exhaustively unit-testable. There is deliberately NO `state = body.state` write path anywhere:
// an admin picks an ACTION, and this maps (currentState, action) → a single allowed target state.
//
// Allowed transitions (everything else is a non-actionable INVALID_TRANSITION, including every
// same-state no-op like FLAG-on-FLAGGED or RESTORE-on-PUBLISHED):
//   FLAG    PUBLISHED → FLAGGED                       (needs investigation; hidden from public)
//   REMOVE  PUBLISHED → REMOVED,  FLAGGED → REMOVED   (public takedown; NOT a DB delete)
//   RESTORE FLAGGED → PUBLISHED,  REMOVED → PUBLISHED (republish; visible again)
// REMOVE/FLAG only change public VISIBILITY via moderationState — the Review row (rating, comment,
// all linkages, timestamps) is never touched, so it stays an auditable record.

export type ReviewModerationAction = "FLAG" | "REMOVE" | "RESTORE";

export const REVIEW_MODERATION_ACTIONS: readonly ReviewModerationAction[] = ["FLAG", "REMOVE", "RESTORE"];

export function isReviewModerationAction(value: unknown): value is ReviewModerationAction {
  return typeof value === "string" && (REVIEW_MODERATION_ACTIONS as readonly string[]).includes(value);
}

// (currentState, action) → target state. A missing entry means the action is not allowed from that
// state (the resolver returns { ok: false }).
const TRANSITIONS: Record<ReviewModerationAction, Partial<Record<ReviewModerationState, ReviewModerationState>>> = {
  FLAG: { PUBLISHED: "FLAGGED" },
  REMOVE: { PUBLISHED: "REMOVED", FLAGGED: "REMOVED" },
  RESTORE: { FLAGGED: "PUBLISHED", REMOVED: "PUBLISHED" },
};

export type ModerationTransition = { ok: true; target: ReviewModerationState } | { ok: false };

/** Resolve the target state for an action from the review's CURRENT state, or { ok:false } when the
 *  action is not applicable to that state (a safe non-actionable outcome — never an arbitrary write). */
export function resolveModerationTransition(
  current: ReviewModerationState,
  action: ReviewModerationAction,
): ModerationTransition {
  const target = TRANSITIONS[action][current];
  return target ? { ok: true, target } : { ok: false };
}

/** The actions an admin may take from a given current state — drives the UI so an impossible action
 *  is never offered (defense-in-depth: the server still re-validates via resolveModerationTransition). */
export function availableModerationActions(current: ReviewModerationState): ReviewModerationAction[] {
  return REVIEW_MODERATION_ACTIONS.filter((action) => TRANSITIONS[action][current] !== undefined);
}

/** The dot-namespaced, past-tense AuditLog action string for a moderation action (BARQ convention). */
export function moderationAuditAction(action: ReviewModerationAction): string {
  return action === "FLAG" ? "review.flagged" : action === "REMOVE" ? "review.removed" : "review.restored";
}
