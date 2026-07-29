import "server-only";
import type { ServiceStatus } from "@prisma/client";

// Service status policy — Phase 4.2 (Provider Experience). The one
// centralized transition matrix every Service status change must be
// validated against — mirrors the booking lifecycle engine's own
// transitions.ts pattern (src/lib/booking/lifecycle/transitions.ts),
// sized to what Service actually needs: a plain state graph, no
// per-status hook dispatcher of its own. Phase 5.2 (Production
// Hardening) added a general AuditLog write at the one call site that
// actually performs the transition (transition-service-status.ts) —
// this policy module itself stays a pure, side-effect-free predicate.

const TRANSITIONS: Record<ServiceStatus, readonly ServiceStatus[]> = {
  DRAFT: ["PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["PAUSED", "ARCHIVED"],
  PAUSED: ["PUBLISHED", "ARCHIVED"],
  // Terminal, deliberately: archiving is a one-way action in this
  // phase — no restore control was requested, and re-introducing an
  // archived experience is a distinct future decision (would it come
  // back as DRAFT or PUBLISHED? that's a real product question, not
  // answered here).
  ARCHIVED: [],
};

export function canTransitionServiceStatus(from: ServiceStatus, to: ServiceStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function canPublishService(status: string): boolean {
  return canTransitionServiceStatus(status as ServiceStatus, "PUBLISHED");
}

export function canUnpublishService(status: string): boolean {
  return canTransitionServiceStatus(status as ServiceStatus, "PAUSED");
}

export function canArchiveService(status: string): boolean {
  return canTransitionServiceStatus(status as ServiceStatus, "ARCHIVED");
}
