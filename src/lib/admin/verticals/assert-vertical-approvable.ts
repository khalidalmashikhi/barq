import "server-only";
import { prisma } from "@/lib/db";
import type { ProviderDocumentStatus, ProviderVerticalType, VerificationRequirementAudience } from "@prisma/client";
import { resolveVerticalDocumentBlockers, type VerticalDocumentBlocker } from "@/lib/provider-document-types";
import { verificationAudienceForVertical } from "@/lib/provider/verticals/vertical-policy";

// Phase 3B — Phase 1. Vertical APPROVAL document-completeness + compliance gate (ADR-0017, vertical
// audience). Resolves requirements for the vertical's OWN audience (TOURIST_GUIDE / RENTAL_COMPANY),
// never the INDIVIDUAL/COMPANY/BOTH business-form audiences.
//
// FAIL CLOSED, three ways — a vertical has NO code-default requirement set to fall back to:
//   • POLICY_UNREADABLE      — the requirement policy could not be read (DB error).
//   • POLICY_NOT_CONFIGURED  — ZERO active+required requirements are configured for this vertical.
//     Empty policy is NEVER "all satisfied": a regulated vertical must not be approvable with no
//     required documents. Optional-only or inactive-only policies also resolve to zero required →
//     POLICY_NOT_CONFIGURED.
//   • DOCUMENTS_INCOMPLETE   — a required document is MISSING / NOT_APPROVED, or (for a requirement
//     whose evidence expires) is missing its expiry or has EXPIRED.
// Only READY (policy configured AND every required document present, APPROVED, and unexpired) permits
// approval.
//
// Accepts an optional `db` client so the caller can RE-CHECK inside the approval transaction
// (time-of-check/time-of-use safety) using the same tx that performs the state-guarded transition.

export type VerticalApprovalReason = "READY" | "POLICY_UNREADABLE" | "POLICY_NOT_CONFIGURED" | "DOCUMENTS_INCOMPLETE";

export type VerticalApprovalReadiness = {
  ready: boolean; // true only when reason === "READY"
  reason: VerticalApprovalReason;
  blockers: VerticalDocumentBlocker[]; // populated only for DOCUMENTS_INCOMPLETE
};

// Minimal client surface satisfied by both the global prisma and a transaction client.
export interface VerticalApprovableClient {
  providerVerificationRequirement: {
    findMany(args: unknown): Promise<
      { key: string; appliesTo: VerificationRequirementAudience; required: boolean; active: boolean; evidenceExpires: boolean }[]
    >;
  };
  providerDocument: {
    findMany(args: unknown): Promise<{ type: string; status: ProviderDocumentStatus; expiresAt: Date | null }[]>;
  };
}

export async function assertVerticalApprovable(
  providerId: string,
  vertical: ProviderVerticalType,
  db: VerticalApprovableClient = prisma,
  now: Date = new Date()
): Promise<VerticalApprovalReadiness> {
  const audience = verificationAudienceForVertical(vertical);

  // Requirement policy — FAIL CLOSED on read error (no vertical code default).
  let requirements: { key: string; appliesTo: VerificationRequirementAudience; required: boolean; active: boolean; evidenceExpires: boolean }[];
  try {
    requirements = await db.providerVerificationRequirement.findMany({
      select: { key: true, appliesTo: true, required: true, active: true, evidenceExpires: true },
    });
  } catch {
    return { ready: false, reason: "POLICY_UNREADABLE", blockers: [] };
  }

  const required = requirements
    .filter((r) => r.active && r.required && r.appliesTo === audience)
    .map((r) => ({ key: r.key, evidenceExpires: r.evidenceExpires }));

  // Empty policy fails closed — zero required requirements is NOT "all satisfied".
  if (required.length === 0) {
    return { ready: false, reason: "POLICY_NOT_CONFIGURED", blockers: [] };
  }

  const documents = await db.providerDocument.findMany({
    where: { providerId },
    select: { type: true, status: true, expiresAt: true },
  });

  const blockers = resolveVerticalDocumentBlockers(required, documents, now);
  return blockers.length === 0
    ? { ready: true, reason: "READY", blockers: [] }
    : { ready: false, reason: "DOCUMENTS_INCOMPLETE", blockers };
}
