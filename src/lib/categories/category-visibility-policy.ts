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

// Resolves 07-CATEGORIES.md's open SubCategory-inheritance question: a
// SubCategory holds its own visibilityStatus, but can never read as more
// visible than its parent Category — a HIDDEN/ARCHIVED parent makes every
// child effectively invisible regardless of the child's own status, since a
// customer could never navigate to it through the (non-existent yet)
// Marketplace browsing surface Category feeds. Category itself has no
// parent, so it only ever consults its own status.
export function isSubCategoryEffectivelyVisible(
  subCategoryStatus: CategoryVisibilityStatus,
  parentCategoryStatus: CategoryVisibilityStatus
): boolean {
  if (parentCategoryStatus === "HIDDEN" || parentCategoryStatus === "ARCHIVED") {
    return false;
  }
  return subCategoryStatus === "PUBLIC";
}
