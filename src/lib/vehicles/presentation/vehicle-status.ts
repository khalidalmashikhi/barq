import type { AssetStatus } from "@prisma/client";

// Vehicle (Asset) status presentation — the SINGLE shared source for how a
// vehicle's AssetStatus is DISPLAYED in the provider workspace. Locale-INDEPENDENT
// only: it never returns translated text — callers resolve the label via
// next-intl using getVehicleStatusTranslationKey() (provider namespace).
//
// DISPLAY-ONLY: VEHICLE-2 renders status, it never mutates it (no lifecycle exists
// yet). Wording is deliberately NEUTRAL — REGISTERED is "Registered", NOT
// "approved" / "awaiting approval"; VERIFIED does not imply customer-visible. The
// domain rule (ACTIVE = public/selectable, everything else = not) lives in
// isVehicleSelectable(), not here. Unknown values fall back to REGISTERED.

const VEHICLE_STATUS_BADGE_VARIANT = {
  REGISTERED: "default",
  VERIFIED: "info",
  ACTIVE: "success",
  UNDER_MAINTENANCE: "warning",
  DEACTIVATED: "danger",
} as const satisfies Record<AssetStatus, "default" | "success" | "warning" | "danger" | "info">;

const VEHICLE_STATUS_TRANSLATION_KEYS = {
  REGISTERED: "vehicleStatusRegistered",
  VERIFIED: "vehicleStatusVerified",
  ACTIVE: "vehicleStatusActive",
  UNDER_MAINTENANCE: "vehicleStatusUnderMaintenance",
  DEACTIVATED: "vehicleStatusDeactivated",
} as const satisfies Record<AssetStatus, string>;

const FALLBACK_VARIANT = VEHICLE_STATUS_BADGE_VARIANT.REGISTERED;
const FALLBACK_TRANSLATION_KEY = VEHICLE_STATUS_TRANSLATION_KEYS.REGISTERED;

export function getVehicleStatusBadgeVariant(status: AssetStatus): "default" | "success" | "warning" | "danger" | "info" {
  return VEHICLE_STATUS_BADGE_VARIANT[status] ?? FALLBACK_VARIANT;
}

// No explicit return annotation — the inferred literal-union type is what the
// strict next-intl translator needs (a widened `string` would be rejected).
export function getVehicleStatusTranslationKey(status: AssetStatus) {
  return VEHICLE_STATUS_TRANSLATION_KEYS[status] ?? FALLBACK_TRANSLATION_KEY;
}
