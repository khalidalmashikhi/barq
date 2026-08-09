import "server-only";
import type { ProviderStatus } from "@prisma/client";

// Provider status presentation — Phase 2.2 (Provider Admin UI). Mirrors
// category-visibility.ts's split: this module only owns the
// locale-INDEPENDENT part (Badge variant); the label text is resolved
// through the real "admin" translation namespace at the call site via
// getProviderStatusTranslationKey(). Reuses the existing Badge
// component's variant set — no new visual vocabulary introduced.

const PROVIDER_STATUS_BADGE_VARIANT = {
  APPLIED: "default",
  UNDER_REVIEW: "info",
  APPROVED: "success",
  REJECTED: "danger",
  SUSPENDED: "warning",
  DEACTIVATED: "danger",
} as const satisfies Record<ProviderStatus, "default" | "success" | "warning" | "danger" | "info">;

const PROVIDER_STATUS_TRANSLATION_KEYS = {
  APPLIED: "statusApplied",
  UNDER_REVIEW: "statusUnderReview",
  APPROVED: "statusApproved",
  REJECTED: "statusRejected",
  SUSPENDED: "statusSuspended",
  DEACTIVATED: "statusDeactivated",
} as const satisfies Record<ProviderStatus, string>;

const FALLBACK_VARIANT = PROVIDER_STATUS_BADGE_VARIANT.APPLIED;

export function getProviderStatusBadgeVariant(status: string) {
  return PROVIDER_STATUS_BADGE_VARIANT[status as ProviderStatus] ?? FALLBACK_VARIANT;
}

export function getProviderStatusTranslationKey(status: string) {
  return PROVIDER_STATUS_TRANSLATION_KEYS[status as ProviderStatus] ?? "statusApplied";
}
