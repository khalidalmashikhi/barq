// STAFF RBAC (Gate Z-3) — the permission taxonomy + role presets. PURE (no server-only,
// no I/O) so it is importable by server guards, the owner Staff UI, nav builders, and
// tests alike. Authority at runtime is a Staff member's own `permissions String[]`
// (OWNER holds all); presets are convenience templates the OWNER may then customize.
//
// The taxonomy is deliberately the SMALLEST coherent set backing BARQ's real internal
// surfaces (Gate Z-3 design, owner-approved). Do NOT add a key without a real route/
// action requiring it, and never split a key that provides no extra security value.

export const PERMISSION_KEYS = [
  "bookings.read",
  "bookings.manage", // availability/slot operations
  "bookings.cancel", // high-impact; NOT in any default preset (OWNER-granted only)

  "providers.read",
  "providers.review", // approve/reject/request-changes + per-document + vehicle verification
  "providers.manage", // create/update/archive/suspend/reactivate/visibility/activity/vehicle activation

  "providerDocuments.read", // SENSITIVE — view provider AND vehicle verification documents; independent of providers.read

  "finance.read",
  "finance.manage", // prices, capture/refund payment

  "reviews.read",
  "reviews.moderate",

  "users.read",
  "users.manage", // customer lifecycle (suspend/reactivate/deactivate)

  "content.read",
  "content.manage", // categories, services, homepage sections

  "settings.manage", // feature flags / platform config

  "audit.read",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

const PERMISSION_KEY_SET: ReadonlySet<string> = new Set(PERMISSION_KEYS);

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && PERMISSION_KEY_SET.has(value);
}

/** Keep only the valid, de-duplicated permission keys from an untrusted list. */
export function sanitizePermissionKeys(values: readonly unknown[]): PermissionKey[] {
  const seen = new Set<PermissionKey>();
  for (const v of values) if (isPermissionKey(v)) seen.add(v);
  // Return in canonical taxonomy order for stable storage/diffs.
  return PERMISSION_KEYS.filter((k) => seen.has(k));
}

// Role presets — convenience templates only; the OWNER may customize after applying one.
// bookings.cancel is deliberately excluded from BOOKING_OPS (high-impact; OWNER-granted).
export const STAFF_PRESETS = {
  BOOKING_OPS: ["bookings.read", "bookings.manage", "providers.read"],
  PROVIDER_VERIFICATION: ["providers.read", "providers.review", "providerDocuments.read"],
  FINANCE: ["finance.read", "finance.manage", "bookings.read"],
  SUPPORT: ["bookings.read", "users.read", "reviews.read"],
  CONTENT_MANAGER: ["content.read", "content.manage"],
  REVIEW_MODERATOR: ["reviews.read", "reviews.moderate"],
} as const satisfies Record<string, readonly PermissionKey[]>;

export type StaffPresetName = keyof typeof STAFF_PRESETS;

export const STAFF_PRESET_NAMES = Object.keys(STAFF_PRESETS) as StaffPresetName[];

export function isStaffPresetName(value: unknown): value is StaffPresetName {
  return typeof value === "string" && value in STAFF_PRESETS;
}

export function presetPermissions(preset: StaffPresetName): PermissionKey[] {
  return [...STAFF_PRESETS[preset]];
}

// The module a permission belongs to — used for permission-driven navigation and for
// grouped, human-friendly labels in the OWNER Staff UI (never show raw enum keys).
export const PERMISSION_MODULE: Record<PermissionKey, string> = {
  "bookings.read": "bookings",
  "bookings.manage": "bookings",
  "bookings.cancel": "bookings",
  "providers.read": "providers",
  "providers.review": "providers",
  "providers.manage": "providers",
  "providerDocuments.read": "providerDocuments",
  "finance.read": "finance",
  "finance.manage": "finance",
  "reviews.read": "reviews",
  "reviews.moderate": "reviews",
  "users.read": "users",
  "users.manage": "users",
  "content.read": "content",
  "content.manage": "content",
  "settings.manage": "settings",
  "audit.read": "audit",
};

/** The distinct modules a permission set unlocks (for nav / allowedModules). */
export function modulesForPermissions(permissions: readonly PermissionKey[]): string[] {
  const set = new Set<string>();
  for (const p of permissions) set.add(PERMISSION_MODULE[p]);
  return [...set];
}
