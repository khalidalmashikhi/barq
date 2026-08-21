import { assetDocumentTypeSupportsExpiry } from "./asset-document-types";

// VEHICLE-LC6 — the provider-claimed expiry DATE, and its strict validation.
//
// TRUST MODEL (the crux of this gate): a provider may CLAIM a document's expiry
// date; that claim is ADVISORY metadata only. It is stored on
// AssetDocument.claimedExpiryDate and is NEVER consumed by isDocumentExpired,
// selectability, the LC4 expiry blockers, or LC5 remediation. Only an ADMIN, at
// approval time, converts a confirmed/corrected date into the authoritative
// AssetDocument.expiresAt instant. So provider input alone can never extend a
// vehicle's eligibility.
//
// A claim is an Oman calendar date "YYYY-MM-DD" (no time / no timezone the provider
// must reason about). It is OPTIONAL, and it is only meaningful for a document type
// that supports expiry (assetDocumentTypeSupportsExpiry) — for any other type a
// claim is silently dropped, so the UI/route never needs a per-type special case.

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ClaimedExpiryDateResult = { ok: true; value: string | null } | { ok: false };

/**
 * Strictly validate an OPTIONAL provider-claimed expiry date for a given document
 * type. Absent/empty → { ok: true, value: null }. A well-formed, REAL calendar date
 * for an expiry-supporting type → { ok: true, value: "YYYY-MM-DD" } (normalized/
 * trimmed). A malformed or impossible date (e.g. 2027-13-01, 2027-02-30) → { ok:false }.
 * A claim supplied for a NON-expiring type is dropped to null (not an error) so the
 * type policy stays centralized. Never returns a trusted instant — that is the
 * admin's authority.
 */
export function parseClaimedExpiryDate(type: string, input: unknown): ClaimedExpiryDateResult {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== "string") return { ok: false };
  const s = input.trim();
  if (s.length === 0) return { ok: true, value: null };
  // A non-expiring document type never carries an expiry claim — drop it silently.
  if (!assetDocumentTypeSupportsExpiry(type)) return { ok: true, value: null };

  const m = DATE_ONLY_RE.exec(s);
  if (!m) return { ok: false };
  const Y = Number(m[1]);
  const Mo = Number(m[2]);
  const D = Number(m[3]);
  // Reject an impossible/rolled-over date deterministically (UTC probe — a pure
  // calendar check, never a timezone conversion).
  const probe = new Date(Date.UTC(Y, Mo - 1, D));
  if (probe.getUTCFullYear() !== Y || probe.getUTCMonth() !== Mo - 1 || probe.getUTCDate() !== D) return { ok: false };
  return { ok: true, value: s };
}
