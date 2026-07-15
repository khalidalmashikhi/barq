// Translation namespace source of truth — BARQ Internationalization,
// Phase 0.
//
// Mirrors the Bounded-Context-per-folder convention already used under
// src/lib/ (booking, services, provider, tracking) — applied here to
// translation files instead of code modules. Both request.ts (message
// loading) and the type-augmentation file import this single list
// rather than re-declaring it.

export const namespaces = [
  "common",
  "auth",
  "booking",
  "services",
  "provider",
  "dashboard",
  "errors",
  "seo",
] as const;

export type Namespace = (typeof namespaces)[number];
