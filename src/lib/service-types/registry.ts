// ServiceType registry — ADR-0015 (frozen).
//
// The CODE-OWNED source of truth for the set of BARQ verticals. A vertical is
// inseparable from its (future) BookingStrategy/PricingStrategy code, so the
// authoritative set lives here — never in an admin-editable table, never a
// dynamically-loaded plugin. It is stored on `Category.serviceTypeKey` as a
// plain string, validated against this registry AND a Postgres CHECK
// constraint (see the P1 expand migration) — deliberately NOT a Prisma enum,
// so adding a vertical never needs an `ALTER TYPE` migration. This mirrors the
// codebase's established convention for governed-extensible identifiers
// (`FeatureFlag.key`, `BookingContract.templateKey`, `AuditLog.action`).
//
// Behavior interfaces (BookingStrategy/PricingStrategy) are DEFERRED by the
// Rule of Two — introduced only when a second vertical creates real
// behavioral divergence. Today only EXPERIENCE has real behavior; the other
// keys are governed classification labels until their own phase builds them.
//
// This module is intentionally isomorphic (no `server-only`): it is pure data
// consumed by both server actions (validation) and server-rendered admin UI
// (the serviceTypeKey select). Adding a vertical = an entry here + the
// migration's CHECK constraint update.

export const SERVICE_TYPE_KEYS = [
  "EXPERIENCE",
  "TRANSPORT",
  "ACCOMMODATION",
  "DINING",
  "EVENT",
  "RENTAL",
] as const;

export type ServiceTypeKey = (typeof SERVICE_TYPE_KEYS)[number];

// The default vertical. EXPERIENCE is the only vertical with real behavior
// today (every existing Service is serviceType "EXPERIENCE"), so it is the
// safe default when a caller does not specify one.
export const DEFAULT_SERVICE_TYPE_KEY: ServiceTypeKey = "EXPERIENCE";

// Admin-facing i18n label key per vertical, resolved in the `admin` namespace.
// Presentation metadata only — never behavior.
export const SERVICE_TYPE_LABEL_KEYS: Record<ServiceTypeKey, string> = {
  EXPERIENCE: "serviceTypeExperience",
  TRANSPORT: "serviceTypeTransport",
  ACCOMMODATION: "serviceTypeAccommodation",
  DINING: "serviceTypeDining",
  EVENT: "serviceTypeEvent",
  RENTAL: "serviceTypeRental",
};

// Runtime guard: is `value` one of the governed vertical keys? Used by every
// write path that accepts a serviceTypeKey, so an invalid value can never
// reach the database (the CHECK constraint is the second line of defense).
export function isValidServiceTypeKey(value: unknown): value is ServiceTypeKey {
  return typeof value === "string" && (SERVICE_TYPE_KEYS as readonly string[]).includes(value);
}
