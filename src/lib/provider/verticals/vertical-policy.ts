import type { OfferingKind, ProviderStatus, ProviderVerticalStatus, ProviderVerticalType, VerificationRequirementAudience } from "@prisma/client";

// Phase 3B — Phase 1. PURE provider-vertical policy (no server-only, no I/O): the mapping
// from a regulated offering to its required vertical, the status predicates that gate
// create/publish, the transition rules, and the canonical error codes. Pure so the server
// guards, server actions, API routes, and tests all share ONE authority.

// A regulated listing kind is created/published only by the provider vertical below.
export const VERTICAL_FOR_OFFERING_KIND: Record<OfferingKind, ProviderVerticalType> = {
  TOUR: "TOURIST_GUIDE",
  VEHICLE_RENTAL: "RENTAL_COMPANY",
};

export function requiredVerticalForOfferingKind(kind: OfferingKind): ProviderVerticalType {
  return VERTICAL_FOR_OFFERING_KIND[kind];
}

// The inverse: every regulated offering kind governed by a given vertical. Used by suspension to
// find the exact listings to hide (a provider's PUBLISHED services carrying one of these kinds),
// and never mislabels — TOUR appears only under TOURIST_GUIDE, VEHICLE_RENTAL only under RENTAL_COMPANY.
export const OFFERING_KINDS_FOR_VERTICAL: Record<ProviderVerticalType, OfferingKind[]> = {
  TOURIST_GUIDE: ["TOUR"],
  RENTAL_COMPANY: ["VEHICLE_RENTAL"],
};

export function offeringKindsForVertical(vertical: ProviderVerticalType): OfferingKind[] {
  return OFFERING_KINDS_FOR_VERTICAL[vertical];
}

// Phase 3B — Phase 1. Each regulated vertical maps to its OWN verification-requirement audience
// (ADR-0017). The enum member names coincide, but the TYPES differ (ProviderVerticalType vs
// VerificationRequirementAudience), so the mapping is explicit — the vertical-approval document
// gate resolves requirements for exactly this audience.
export const VERIFICATION_AUDIENCE_FOR_VERTICAL: Record<ProviderVerticalType, VerificationRequirementAudience> = {
  TOURIST_GUIDE: "TOURIST_GUIDE",
  RENTAL_COMPANY: "RENTAL_COMPANY",
};

export function verificationAudienceForVertical(vertical: ProviderVerticalType): VerificationRequirementAudience {
  return VERIFICATION_AUDIENCE_FOR_VERTICAL[vertical];
}

// Phase-1 auto-classification: only VEHICLE_RENTAL is safely derivable from the taxonomy
// (serviceType RENTAL / the Car-Rentals category). A guided TOUR is NOT inferred from a
// generic EXPERIENCE service — that classification carries an explicit signal in the later
// tour gate, so this returns null for everything except RENTAL (never mislabels legacy data).
export function offeringKindForServiceType(serviceType: string): OfferingKind | null {
  return serviceType === "RENTAL" ? "VEHICLE_RENTAL" : null;
}

export function isRegulatedOfferingKind(kind: OfferingKind | null | undefined): kind is OfferingKind {
  return kind === "TOUR" || kind === "VEHICLE_RENTAL";
}

// Phase 3B — Phase 1. Which PROVIDER-ACCOUNT statuses may request/resubmit a regulated vertical.
// A provider needs to select the intended activity and submit its activity-specific documents DURING
// onboarding — before the main account reaches APPROVED — so the eligible set spans the active
// onboarding states through APPROVED. REJECTED (application refused), SUSPENDED, and DEACTIVATED are
// excluded: those accounts must resolve their own account state first (SUSPENDED/DEACTIVATED are
// already blocked upstream by requireProvider; REJECTED is excluded here). Publishing still requires
// BOTH the main Provider = APPROVED and the vertical = APPROVED — this only governs REQUESTING.
export const VERTICAL_REQUEST_ELIGIBLE_STATUSES: readonly ProviderStatus[] = [
  "DRAFT",
  "APPLIED",
  "UNDER_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
];

export function canProviderRequestVertical(status: ProviderStatus): boolean {
  return VERTICAL_REQUEST_ELIGIBLE_STATUSES.includes(status);
}

// A provider may prepare/edit a DRAFT listing while its vertical is requested but not yet
// approved (PENDING_REVIEW / CHANGES_REQUESTED / APPROVED) — but NOT while REJECTED or
// SUSPENDED, and not with no request at all (handled by the caller as "not requested").
export function canCreateDraftWithVerticalStatus(status: ProviderVerticalStatus): boolean {
  return status === "PENDING_REVIEW" || status === "CHANGES_REQUESTED" || status === "APPROVED";
}

// Publishing requires an APPROVED vertical — nothing weaker.
export function canPublishWithVerticalStatus(status: ProviderVerticalStatus): boolean {
  return status === "APPROVED";
}

// Allowed ProviderVertical status transitions (mirrors provider/asset review shapes).
const TRANSITIONS: Record<ProviderVerticalStatus, ReadonlySet<ProviderVerticalStatus>> = {
  PENDING_REVIEW: new Set(["APPROVED", "CHANGES_REQUESTED", "REJECTED"]),
  CHANGES_REQUESTED: new Set(["PENDING_REVIEW", "APPROVED", "REJECTED"]),
  REJECTED: new Set(["PENDING_REVIEW"]),
  APPROVED: new Set(["SUSPENDED"]),
  SUSPENDED: new Set(["APPROVED"]),
};

export function canTransitionVertical(from: ProviderVerticalStatus, to: ProviderVerticalStatus): boolean {
  return TRANSITIONS[from]?.has(to) ?? false;
}

// Canonical, non-enumerating error codes for every vertical denial/failure. Mapped to result
// codes by server actions and to a single FORBIDDEN by API routes; never leaks internals.
export type VerticalErrorCode =
  | "INVALID_INPUT"
  | "INVALID_VERTICAL"
  | "VERTICAL_NOT_REQUESTED" // no vertical row → cannot create/publish that listing kind
  | "VERTICAL_NOT_APPROVED" // requested/changes but not APPROVED → cannot publish
  | "VERTICAL_REJECTED_OR_SUSPENDED" // rejected/suspended → cannot create or publish
  | "VERTICAL_ALREADY_EXISTS" // duplicate request of an existing (non-resubmittable) vertical
  | "VERTICAL_DOCUMENTS_INCOMPLETE" // required vertical documents missing / not APPROVED / expired
  | "VERTICAL_POLICY_NOT_CONFIGURED" // ZERO active required requirements configured for the vertical (or policy unreadable) → fail closed
  | "VERTICAL_NOT_FOUND"
  | "VERTICAL_STATE_CONFLICT" // concurrent review lost the state-guarded update
  | "NO_PROVIDER_PROFILE"
  | "PROVIDER_NOT_ELIGIBLE" // the provider ACCOUNT state (e.g. REJECTED/SUSPENDED/DEACTIVATED) may not request a vertical
  | "FORBIDDEN" // caller lacks the required permission (admin review actions)
  | "UNKNOWN_ERROR";
