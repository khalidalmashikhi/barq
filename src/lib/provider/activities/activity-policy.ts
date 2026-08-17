// Gate B4 — the pure, server-authoritative activity-governance policy (no I/O).
// Centralizes the rules so no `length > 1` / status check is scattered across
// actions and UI.
//
// Invariants (enforced by the actions that import this + the B1 partial unique
// index `provider_categories_one_primary`):
//   SELF   — at most ONE row per provider, and it is the primary. The provider
//            controls only its INITIAL selection and (while DRAFT) its replacement.
//   ADMIN  — zero or more, never primary, created/revoked ONLY by an ACTIVE admin.
//   LEGACY — preserved & authorized; the provider can never mutate it via
//            self-service, and it is never silently relabelled.

/// A provider self-selects at most this many activities (the single primary).
export const MAX_PROVIDER_SELF_ACTIVITIES = 1;

/// A provider may set OR replace their one self-selected primary activity ONLY
/// while the application is still an unsubmitted DRAFT. After submission/approval
/// the primary is locked — changing it would affect verification scope, existing
/// services, the public profile and (future B5) service authorization, so it
/// becomes an explicit admin/review concern rather than a self-service toggle.
export function canProviderEditPrimaryActivity(providerStatus: string): boolean {
  return providerStatus === "DRAFT";
}
