import "server-only";
import type { PriceStatus } from "@prisma/client";

// Price status presentation — Phase 2.6 (Pricing Admin UI). Mirrors
// admin/presentation/service-status.ts's split exactly: this module
// only owns the locale-INDEPENDENT part (Badge variant); label text is
// resolved through the real "admin" translation namespace at the call
// site via getPriceStatusTranslationKey(). Reuses the existing Badge
// component's variant set — no new visual vocabulary introduced.

const PRICE_STATUS_BADGE_VARIANT = {
  ACTIVE: "success",
  SUPERSEDED: "default",
} as const satisfies Record<PriceStatus, "default" | "success" | "warning" | "danger" | "info">;

const PRICE_STATUS_TRANSLATION_KEYS = {
  ACTIVE: "priceStatusActive",
  SUPERSEDED: "priceStatusSuperseded",
} as const satisfies Record<PriceStatus, string>;

const FALLBACK_VARIANT = PRICE_STATUS_BADGE_VARIANT.ACTIVE;

export function getPriceStatusBadgeVariant(status: string) {
  return PRICE_STATUS_BADGE_VARIANT[status as PriceStatus] ?? FALLBACK_VARIANT;
}

export function getPriceStatusTranslationKey(status: string) {
  return PRICE_STATUS_TRANSLATION_KEYS[status as PriceStatus] ?? "priceStatusActive";
}
