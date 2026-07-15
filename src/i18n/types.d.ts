import type { Locale } from "./locales";

// Type-safe translation keys — BARQ Internationalization, Phase 0.
//
// Augments use-intl's `AppConfig` (the interface next-intl itself
// re-exports and reads from) with BARQ's actual Locale union and a
// canonical Messages shape, so `useTranslations()`/`getTranslations()`
// calls are checked against real keys once real call sites exist in a
// later phase — a typo'd or renamed key becomes a `tsc` error, not a
// silent runtime gap.
//
// English is the canonical shape (not Arabic): English has no
// RTL-specific string-shape quirks and is the language ADR-0010
// Requirement 2 guarantees full parity for, making it the safer
// "shape of truth" to type-check every other locale's message files
// against structurally (a namespace/key existing in en/*.json but
// missing from, say, cs/*.json is exactly the class of drift this
// augmentation is meant to catch once real content is migrated).
//
// The 8 namespace imports below intentionally mirror namespaces.ts's
// list — TypeScript's `typeof import(...)` requires a literal module
// specifier per entry, so this list cannot be generated from that
// runtime array. Keep the two in sync manually; this is the one
// unavoidable exception to "do not duplicate," inherent to how
// statically-typed module augmentation works, not an arbitrary copy.
type Messages = {
  common: typeof import("../../messages/en/common.json");
  auth: typeof import("../../messages/en/auth.json");
  booking: typeof import("../../messages/en/booking.json");
  services: typeof import("../../messages/en/services.json");
  provider: typeof import("../../messages/en/provider.json");
  dashboard: typeof import("../../messages/en/dashboard.json");
  errors: typeof import("../../messages/en/errors.json");
  seo: typeof import("../../messages/en/seo.json");
};

declare module "use-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
