import "server-only";
import type { CategoryVisibilityStatus } from "@prisma/client";

// Category visibility presentation — Phase 1.2 (Category Admin UI).
// Mirrors src/lib/services/presentation/service-status.ts's Record<Enum,
// string>-keyed idiom, but DELIBERATELY splits label from style: that
// module hardcodes Arabic-only label text regardless of locale (a known,
// pre-existing limitation, not fixed here since it's out of this phase's
// scope) — copying that pattern would spread the same bug into new code.
// This module only owns the locale-INDEPENDENT part (Tailwind classes);
// the actual label text is resolved through the real "admin" translation
// namespace at the call site via getCategoryVisibilityTranslationKey().

const CATEGORY_VISIBILITY_STYLES: Record<CategoryVisibilityStatus, string> = {
  PUBLIC: "bg-success/10 text-success",
  HIDDEN: "bg-foreground/10 text-foreground/50",
  LINK_ONLY: "bg-secondary/10 text-secondary",
  INVITE_ONLY: "bg-secondary/10 text-secondary",
  SCHEDULED: "bg-accent/25 text-accent-foreground",
  ARCHIVED: "bg-danger/10 text-danger",
};

const CATEGORY_VISIBILITY_TRANSLATION_KEYS = {
  PUBLIC: "visibilityPublic",
  HIDDEN: "visibilityHidden",
  LINK_ONLY: "visibilityLinkOnly",
  INVITE_ONLY: "visibilityInviteOnly",
  SCHEDULED: "visibilityScheduled",
  ARCHIVED: "visibilityArchived",
} as const satisfies Record<CategoryVisibilityStatus, string>;

const FALLBACK_STYLE = CATEGORY_VISIBILITY_STYLES.HIDDEN;

export function getCategoryVisibilityStyle(status: string): string {
  return CATEGORY_VISIBILITY_STYLES[status as CategoryVisibilityStatus] ?? FALLBACK_STYLE;
}

export function getCategoryVisibilityTranslationKey(status: string) {
  return CATEGORY_VISIBILITY_TRANSLATION_KEYS[status as CategoryVisibilityStatus] ?? "visibilityHidden";
}
