// VEHICLE-LC4 — the SINGLE authoritative document-expiry comparison.
//
// Expiry is a DERIVED eligibility condition, never a stored status. An APPROVED
// document whose `expiresAt` has passed stays historically APPROVED (history is
// preserved — no cron, no status churn) but is operationally INVALID for
// selectability. This one comparison is the source of truth reused by the
// selectability blockers, the admin approval blockers, and the provider read-model
// `isExpired` flag — so the public reader, UI, and admin action never diverge.
//
// BOUNDARY (UTC instant semantics — expiresAt is DateTime @db.Timestamptz):
//   expiresAt == null   -> never expires (valid)
//   expiresAt >  now     -> valid
//   expiresAt <= now     -> EXPIRED   (inclusive: the instant it lapses, it's expired)

export function isDocumentExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}
