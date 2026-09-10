import "server-only";
import { prisma } from "@/lib/db";
import type { OfferingKind, ProviderVerticalStatus, ProviderVerticalType } from "@prisma/client";
import {
  requiredVerticalForOfferingKind,
  canCreateDraftWithVerticalStatus,
  isRegulatedOfferingKind,
  type VerticalErrorCode,
} from "./vertical-policy";
// Read-only compliance query (policy + document + expiry readiness). Imported here so publish and
// booking-acceptance enforce CURRENT compliance validity, not merely status === APPROVED.
import { assertVerticalApprovable, type VerticalApprovableClient } from "@/lib/admin/verticals/assert-vertical-approvable";

// Phase 3B — Phase 1. THE server-side authorization for regulated listings. This is the sole
// authority for "may this provider create/publish this listing kind"; category grants
// (ProviderCategory) never confer it. Callers integrate the returned VerticalErrorCode into
// their own result shape (server actions) or map it to a canonical FORBIDDEN (API routes).

export async function getProviderVerticalStatus(
  providerId: string,
  vertical: ReturnType<typeof requiredVerticalForOfferingKind>
): Promise<ProviderVerticalStatus | null> {
  const row = await prisma.providerVertical.findUnique({
    where: { providerId_vertical: { providerId, vertical } },
    select: { status: true },
  });
  return row?.status ?? null;
}

/**
 * May the provider CREATE or EDIT a DRAFT listing of `kind`? Regulated kinds require a
 * requested vertical that is not REJECTED/SUSPENDED (PENDING_REVIEW / CHANGES_REQUESTED /
 * APPROVED all permit drafting — the provider prepares while approval is pending). Publishing
 * is gated separately (below). Returns null when allowed.
 */
export async function assertCanCreateListing(providerId: string, kind: OfferingKind | null | undefined): Promise<VerticalErrorCode | null> {
  if (!isRegulatedOfferingKind(kind)) return null; // unregulated (e.g. legacy EXPERIENCE) — no gate
  const vertical = requiredVerticalForOfferingKind(kind);
  const status = await getProviderVerticalStatus(providerId, vertical);
  if (status === null) return "VERTICAL_NOT_REQUESTED";
  if (status === "REJECTED" || status === "SUSPENDED") return "VERTICAL_REJECTED_OR_SUSPENDED";
  if (!canCreateDraftWithVerticalStatus(status)) return "VERTICAL_REJECTED_OR_SUSPENDED";
  return null;
}

/**
 * May the provider PUBLISH this service? A regulated kind requires an APPROVED vertical —
 * UNLESS the service is `legacyVerticalExempt` (a pre-cutover, already-published listing that
 * is grandfathered so live listings never break at rollout). A material regulated change
 * clears `legacyVerticalExempt` at the edit path, so the next publish is gated. A non-regulated
 * (null) kind is never gated — and a NEW regulated service always carries a non-null kind set
 * server-side at create, so the null state can never be used to bypass this. Returns null when
 * allowed.
 */
export async function assertCanPublishListing(params: {
  providerId: string;
  offeringKind: OfferingKind | null | undefined;
  legacyVerticalExempt: boolean;
}): Promise<VerticalErrorCode | null> {
  const { providerId, offeringKind, legacyVerticalExempt } = params;
  if (!isRegulatedOfferingKind(offeringKind)) return null; // unregulated / legacy null-kind
  const vertical = requiredVerticalForOfferingKind(offeringKind);
  const status = await getProviderVerticalStatus(providerId, vertical);
  // Suspension / rejection is an ENFORCEMENT action that grandfathering does NOT override: a
  // SUSPENDED or REJECTED vertical blocks (re)publishing of EVERY listing in it, legacyVerticalExempt
  // included. This closes the hole where a suspended provider could re-publish a grandfathered listing.
  if (status === "SUSPENDED" || status === "REJECTED") return "VERTICAL_REJECTED_OR_SUSPENDED";
  // Grandfathered pre-cutover published listing — exempt from the approval+compliance requirement
  // (never from suspension, handled above).
  if (legacyVerticalExempt) return null;
  if (status === null) return "VERTICAL_NOT_REQUESTED";
  if (status !== "APPROVED") return "VERTICAL_NOT_APPROVED";
  // APPROVED is necessary but NOT sufficient: publishing a new listing is a regulated operation that
  // must satisfy CURRENT compliance validity — a configured non-empty required policy AND all
  // required documents present, APPROVED, and unexpired. A lapsed licence or an emptied policy blocks
  // publishing even though the vertical row stays APPROVED (no status churn).
  const readiness = await assertVerticalApprovable(providerId, vertical);
  if (readiness.ready) return null;
  return readiness.reason === "DOCUMENTS_INCOMPLETE" ? "VERTICAL_DOCUMENTS_INCOMPLETE" : "VERTICAL_POLICY_NOT_CONFIGURED";
}

/**
 * Phase 3B — Phase 1 (Blockers 4 + compliance). May a provider ACCEPT a pending booking for
 * `offeringKind`? Acceptance commits new resources, so it must satisfy current compliance:
 *   • SUSPENDED / REJECTED vertical → FROZEN (grandfathering never bypasses this — status only).
 *   • APPROVED but NON-compliant (empty/unreadable policy, or a required licence missing/expired)
 *     → FROZEN (the licence lapsed even though the row is still APPROVED).
 *   • null / PENDING_REVIEW / CHANGES_REQUESTED, or APPROVED + compliant → allowed, so existing
 *     bookings (including on grandfathered / still-pending listings) are honored.
 * Returns null when acceptance is allowed.
 */
export async function assertVerticalAllowsBookingAcceptance(params: {
  providerId: string;
  offeringKind: OfferingKind | null | undefined;
}): Promise<VerticalErrorCode | null> {
  const { providerId, offeringKind } = params;
  if (!isRegulatedOfferingKind(offeringKind)) return null;
  const vertical = requiredVerticalForOfferingKind(offeringKind);
  const status = await getProviderVerticalStatus(providerId, vertical);
  if (status === "SUSPENDED" || status === "REJECTED") return "VERTICAL_REJECTED_OR_SUSPENDED";
  // Only an APPROVED vertical is subject to the ongoing-compliance freeze; null/PENDING/CHANGES honor
  // existing bookings (they were legitimately taken on a grandfathered/pending listing).
  if (status !== "APPROVED") return null;
  const readiness = await assertVerticalApprovable(providerId, vertical);
  if (readiness.ready) return null;
  return readiness.reason === "DOCUMENTS_INCOMPLETE" ? "VERTICAL_DOCUMENTS_INCOMPLETE" : "VERTICAL_POLICY_NOT_CONFIGURED";
}

/**
 * Reusable read-only compliance query for a provider vertical — the single guard publishing and
 * booking-acceptance share (correctness-first; callers may cache/optimize later). Returns a stable
 * shape so callers map it into their own error vocabulary. `db` allows an in-transaction re-check.
 */
export type VerticalComplianceResult =
  | { compliant: true; status: ProviderVerticalStatus }
  | { compliant: false; status: ProviderVerticalStatus | null; reason: VerticalErrorCode };

export async function evaluateVerticalCompliance(
  providerId: string,
  vertical: ProviderVerticalType,
  db?: VerticalApprovableClient
): Promise<VerticalComplianceResult> {
  const status = await getProviderVerticalStatus(providerId, vertical);
  if (status === "SUSPENDED" || status === "REJECTED") return { compliant: false, status, reason: "VERTICAL_REJECTED_OR_SUSPENDED" };
  if (status === null) return { compliant: false, status, reason: "VERTICAL_NOT_REQUESTED" };
  if (status !== "APPROVED") return { compliant: false, status, reason: "VERTICAL_NOT_APPROVED" };
  const readiness = await assertVerticalApprovable(providerId, vertical, db);
  if (readiness.ready) return { compliant: true, status };
  return {
    compliant: false,
    status,
    reason: readiness.reason === "DOCUMENTS_INCOMPLETE" ? "VERTICAL_DOCUMENTS_INCOMPLETE" : "VERTICAL_POLICY_NOT_CONFIGURED",
  };
}
