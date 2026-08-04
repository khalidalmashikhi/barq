import "server-only";
import type { CategoryVisibilityStatus } from "@prisma/client";

// Category visibility policy — Phase 1.1 (Core Business Platform). Mirrors
// service-status-policy.ts's transition-matrix pattern, sized to BR-004's 6
// states: a plain state graph, no per-status hook dispatcher of its own.

const TRANSITIONS: Record<CategoryVisibilityStatus, readonly CategoryVisibilityStatus[]> = {
  HIDDEN: ["PUBLIC", "LINK_ONLY", "INVITE_ONLY", "SCHEDULED", "ARCHIVED"],
  PUBLIC: ["HIDDEN", "LINK_ONLY", "INVITE_ONLY", "ARCHIVED"],
  LINK_ONLY: ["PUBLIC", "HIDDEN", "INVITE_ONLY", "ARCHIVED"],
  INVITE_ONLY: ["PUBLIC", "HIDDEN", "LINK_ONLY", "ARCHIVED"],
  SCHEDULED: ["PUBLIC", "HIDDEN", "ARCHIVED"],
  // Terminal, deliberately: archiving is a one-way action in this phase,
  // mirroring service-status-policy.ts's own ARCHIVED handling — whether an
  // archived Category can ever be restored is a distinct future decision.
  ARCHIVED: [],
};

export function canTransitionCategoryVisibility(
  from: CategoryVisibilityStatus,
  to: CategoryVisibilityStatus
): boolean {
  return TRANSITIONS[from].includes(to);
}

// SCHEDULED requires a future scheduledVisibleAt — the one state with a
// structural precondition beyond the transition graph itself.
export function isValidScheduledVisibility(scheduledVisibleAt: Date | null | undefined): boolean {
  return scheduledVisibleAt !== null && scheduledVisibleAt !== undefined && scheduledVisibleAt.getTime() > Date.now();
}

// Effective visibility across the Category tree (ADR-0015). A node can never
// read as more visible than its ancestors: a HIDDEN or ARCHIVED ancestor makes
// the whole subtree effectively invisible, regardless of the node's own
// status. This generalizes the former SubCategory-only rule to evaluate EVERY
// ancestor (not just the immediate parent), so it stays correct if the tree's
// max depth is ever raised. A root (no ancestors) is effectively visible iff
// it is itself PUBLIC. Preserves the original semantics exactly: only HIDDEN/
// ARCHIVED ancestors gate; other ancestor states do not.
export function isCategoryEffectivelyVisible(
  nodeStatus: CategoryVisibilityStatus,
  ancestorStatuses: readonly CategoryVisibilityStatus[] = []
): boolean {
  if (ancestorStatuses.some((status) => status === "HIDDEN" || status === "ARCHIVED")) {
    return false;
  }
  return nodeStatus === "PUBLIC";
}
