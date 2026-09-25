import type { RentalOfferingStatus } from "@prisma/client";
import type { RentalOfferingErrorCode } from "../rental-offering-errors";

// Phase 3C Slice C2d-R1 — the SINGLE shared source for how a rental offering's lifecycle status and
// its readiness/publish blockers are DISPLAYED in the provider rental workspace. Locale-INDEPENDENT:
// it never returns translated text — callers resolve the label via next-intl (provider namespace)
// using the returned key. Mirrors src/lib/vehicles/presentation/vehicle-status.ts exactly.

const RENTAL_OFFERING_STATUS_BADGE_VARIANT = {
  DRAFT: "info",
  PUBLISHED: "success",
  SUSPENDED: "warning",
  ARCHIVED: "default",
} as const satisfies Record<RentalOfferingStatus, "default" | "success" | "warning" | "danger" | "info">;

const RENTAL_OFFERING_STATUS_TRANSLATION_KEYS = {
  DRAFT: "rentalOfferingStatusDraft",
  PUBLISHED: "rentalOfferingStatusPublished",
  SUSPENDED: "rentalOfferingStatusSuspended",
  ARCHIVED: "rentalOfferingStatusArchived",
} as const satisfies Record<RentalOfferingStatus, string>;

const FALLBACK_VARIANT = RENTAL_OFFERING_STATUS_BADGE_VARIANT.DRAFT;
const FALLBACK_STATUS_KEY = RENTAL_OFFERING_STATUS_TRANSLATION_KEYS.DRAFT;

export function getRentalOfferingStatusBadgeVariant(status: RentalOfferingStatus): "default" | "success" | "warning" | "danger" | "info" {
  return RENTAL_OFFERING_STATUS_BADGE_VARIANT[status] ?? FALLBACK_VARIANT;
}

// No explicit return annotation — the inferred literal-union type is what the strict next-intl
// translator needs (a widened `string` would be rejected).
export function getRentalOfferingStatusTranslationKey(status: RentalOfferingStatus) {
  return RENTAL_OFFERING_STATUS_TRANSLATION_KEYS[status] ?? FALLBACK_STATUS_KEY;
}

// Readiness / publish-blocker codes → provider-namespace label keys. Reused by the offering list
// (readiness warning) and, in Checkpoint B, the publish/lifecycle UX (human-readable blockers). Only
// the codes a provider can act on are surfaced; internal document identifiers are never revealed.
const RENTAL_BLOCKER_TRANSLATION_KEYS = {
  PROVIDER_NOT_APPROVED: "rentalBlockerProviderNotApproved",
  NO_PROVIDER_PROFILE: "rentalBlockerProviderNotApproved",
  VERTICAL_NOT_AUTHORIZED: "rentalBlockerVerticalNotAuthorized",
  VERTICAL_NOT_COMPLIANT: "rentalBlockerVerticalNotCompliant",
  VEHICLE_NOT_SELECTABLE: "rentalBlockerVehicleNotSelectable",
  VERIFIED_CAPACITY_MISSING: "rentalBlockerCapacityMissing",
  NO_PUBLISHABLE_DAY: "rentalBlockerNoOpenDay",
} as const;

export type RentalReadinessBlockerCode = keyof typeof RENTAL_BLOCKER_TRANSLATION_KEYS;

export function isRentalReadinessBlocker(code: RentalOfferingErrorCode): code is RentalReadinessBlockerCode {
  return code in RENTAL_BLOCKER_TRANSLATION_KEYS;
}

export function getRentalBlockerTranslationKey(code: RentalReadinessBlockerCode) {
  return RENTAL_BLOCKER_TRANSLATION_KEYS[code];
}

/** The lifecycle transitions VALID from a given status (the lifecycle panel offers exactly these). */
export type RentalLifecycleTransition = "publish" | "suspend" | "archive";

const RENTAL_TRANSITIONS_BY_STATUS = {
  DRAFT: ["publish", "archive"],
  PUBLISHED: ["suspend", "archive"],
  SUSPENDED: ["publish", "archive"],
  ARCHIVED: [],
} as const satisfies Record<RentalOfferingStatus, readonly RentalLifecycleTransition[]>;

export function validRentalTransitions(status: RentalOfferingStatus): readonly RentalLifecycleTransition[] {
  return RENTAL_TRANSITIONS_BY_STATUS[status] ?? [];
}
