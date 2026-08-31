import { describe, it, expect } from "vitest";
import {
  resolveModerationTransition,
  availableModerationActions,
  moderationAuditAction,
  isReviewModerationAction,
} from "./review-moderation-policy";

// REVIEW TRUST & SAFETY — the pure transition policy. Pins the exact allowed state machine and the
// safe non-actionable outcome for every same-state / disallowed combination.

describe("resolveModerationTransition — allowed transitions", () => {
  it.each([
    ["PUBLISHED", "FLAG", "FLAGGED"],
    ["PUBLISHED", "REMOVE", "REMOVED"],
    ["FLAGGED", "REMOVE", "REMOVED"],
    ["FLAGGED", "RESTORE", "PUBLISHED"],
    ["REMOVED", "RESTORE", "PUBLISHED"],
  ] as const)("%s + %s → %s", (current, action, target) => {
    expect(resolveModerationTransition(current, action)).toEqual({ ok: true, target });
  });
});

describe("resolveModerationTransition — disallowed / same-state → non-actionable", () => {
  it.each([
    ["PUBLISHED", "RESTORE"], // already public
    ["FLAGGED", "FLAG"], // already flagged
    ["REMOVED", "REMOVE"], // already removed
    ["REMOVED", "FLAG"], // cannot flag a removed review — republish first
  ] as const)("%s + %s → { ok:false }", (current, action) => {
    expect(resolveModerationTransition(current, action)).toEqual({ ok: false });
  });
});

describe("availableModerationActions — drives the UI (never offers an impossible action)", () => {
  it("PUBLISHED → Flag + Remove", () => {
    expect(availableModerationActions("PUBLISHED").sort()).toEqual(["FLAG", "REMOVE"].sort());
  });
  it("FLAGGED → Remove + Restore", () => {
    expect(availableModerationActions("FLAGGED").sort()).toEqual(["REMOVE", "RESTORE"].sort());
  });
  it("REMOVED → Restore only", () => {
    expect(availableModerationActions("REMOVED")).toEqual(["RESTORE"]);
  });
});

describe("moderationAuditAction + isReviewModerationAction", () => {
  it("maps each action to its dot-namespaced past-tense audit string", () => {
    expect(moderationAuditAction("FLAG")).toBe("review.flagged");
    expect(moderationAuditAction("REMOVE")).toBe("review.removed");
    expect(moderationAuditAction("RESTORE")).toBe("review.restored");
  });
  it("narrows only the three real actions", () => {
    for (const a of ["FLAG", "REMOVE", "RESTORE"]) expect(isReviewModerationAction(a)).toBe(true);
    for (const a of ["PUBLISH", "DELETE", "", null, 3]) expect(isReviewModerationAction(a)).toBe(false);
  });
});
