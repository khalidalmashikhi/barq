import "server-only";
import type { AvailabilitySlotState } from "@prisma/client";

// Availability state presentation — Phase 2.8 (Availability Admin UI).
// Mirrors admin/presentation/price-status.ts's/service-status.ts's
// split exactly: this module only owns the locale-INDEPENDENT part
// (Badge variant); label text is resolved through the real "admin"
// translation namespace at the call site via
// getAvailabilityStateTranslationKey(). Reuses the existing Badge
// component's variant set — no new visual vocabulary introduced.
//
// Distinct from the pre-existing src/lib/tracking/presentation/
// availability-state.ts (Provider Dashboard), which hardcodes Arabic
// label text and Tailwind classes directly rather than i18n-keyed
// translation — the same kind of pre-existing dual-pattern already
// noted for Service in Phase 2.4's own Pattern Regression Check, not a
// new inconsistency this phase introduces.

const AVAILABILITY_STATE_BADGE_VARIANT = {
  OPEN: "success",
  BLOCKED: "warning",
  CANCELLED: "danger",
} as const satisfies Record<AvailabilitySlotState, "default" | "success" | "warning" | "danger" | "info">;

const AVAILABILITY_STATE_TRANSLATION_KEYS = {
  OPEN: "availabilityStateOpen",
  BLOCKED: "availabilityStateBlocked",
  CANCELLED: "availabilityStateCancelled",
} as const satisfies Record<AvailabilitySlotState, string>;

const FALLBACK_VARIANT = AVAILABILITY_STATE_BADGE_VARIANT.OPEN;

export function getAvailabilityStateBadgeVariant(state: string) {
  return AVAILABILITY_STATE_BADGE_VARIANT[state as AvailabilitySlotState] ?? FALLBACK_VARIANT;
}

export function getAvailabilityStateTranslationKey(state: string) {
  return AVAILABILITY_STATE_TRANSLATION_KEYS[state as AvailabilitySlotState] ?? "availabilityStateOpen";
}
