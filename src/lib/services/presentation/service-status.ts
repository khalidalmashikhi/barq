import "server-only";
import type { ServiceStatus } from "@prisma/client";

// Service status presentation — the SINGLE shared source for how
// ServiceStatus is presented anywhere in the app (Provider Dashboard,
// Admin UI). Consolidated during "Service Status Localization &
// Presentation Consolidation" — this module used to hardcode Arabic
// label text and raw Tailwind classes directly (a locale bug: the
// Arabic label always rendered, even on the English locale), while a
// second, separate module (src/lib/admin/presentation/service-status.ts)
// already did this correctly (locale-independent Badge variant +
// translation key, resolved via next-intl at the call site). That
// second module is now deleted — this file replaces it, using its
// exact variant/key mapping so neither surface's colors change.
//
// LOCALE-INDEPENDENT ONLY: this module never returns translated text.
// Callers resolve the label via next-intl using getServiceStatusTranslationKey()'s
// result — see provider/services/page.tsx, provider/services/[id]/page.tsx,
// admin/services/page.tsx, admin/services/[id]/page.tsx for the pattern.
//
// TRANSLATION NAMESPACE: the 4 keys below already exist, fully
// translated in all 8 locales, in messages/*/admin.json (predating this
// consolidation). Reused as-is rather than duplicated into a second
// namespace — see this phase's own instruction not to duplicate
// translation keys unnecessarily. The "admin" namespace name is a
// pre-existing artifact, not a statement that this concept is
// admin-only; ServiceStatus itself belongs to the Services bounded
// context (hence this module's location), and both Provider and Admin
// pages call getServerTranslator("admin") to resolve these 4 keys.
//
// UNKNOWN VALUES: both getters fall back to the DRAFT mapping rather
// than throwing or rendering a raw enum value — mirrors this module's
// own prior fallback behavior and the admin module's it replaces.

const SERVICE_STATUS_BADGE_VARIANT = {
  DRAFT: "default",
  PUBLISHED: "success",
  PAUSED: "warning",
  ARCHIVED: "danger",
} as const satisfies Record<ServiceStatus, "default" | "success" | "warning" | "danger" | "info">;

const SERVICE_STATUS_TRANSLATION_KEYS = {
  DRAFT: "serviceStatusDraft",
  PUBLISHED: "serviceStatusPublished",
  PAUSED: "serviceStatusPaused",
  ARCHIVED: "serviceStatusArchived",
} as const satisfies Record<ServiceStatus, string>;

const FALLBACK_VARIANT = SERVICE_STATUS_BADGE_VARIANT.DRAFT;
const FALLBACK_TRANSLATION_KEY = SERVICE_STATUS_TRANSLATION_KEYS.DRAFT;

export function getServiceStatusBadgeVariant(status: string) {
  return SERVICE_STATUS_BADGE_VARIANT[status as ServiceStatus] ?? FALLBACK_VARIANT;
}

export function getServiceStatusTranslationKey(status: string) {
  return SERVICE_STATUS_TRANSLATION_KEYS[status as ServiceStatus] ?? FALLBACK_TRANSLATION_KEY;
}
