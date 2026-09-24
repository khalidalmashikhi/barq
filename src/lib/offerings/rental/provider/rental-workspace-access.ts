import "server-only";
import type { ProviderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, ForbiddenError, UnauthenticatedError } from "@/lib/auth";
import { assertRentalDraftAuthorized } from "../rental-offering-authorization";

// Phase 3C Slice C2d-R1 (correction) — the SINGLE, server-authoritative access decision for the
// vehicle-rental management workspace. It is the one place navigation visibility, the two workspace
// pages, and future Checkpoint-B entry points all consult, so nav and route access can never drift.
//
// LEGAL BOUNDARY: vehicle-only rental belongs exclusively to a RENTAL_COMPANY. A TOURIST_GUIDE (or
// any unrelated vertical) can never manage a rental offering; owning a vehicle grants nothing; a
// category grants nothing. Provider identity is always session-derived — never client-supplied.
//
// VIEW vs MUTATE vs PUBLISH — deliberately NOT one permissive boolean:
//   • canViewWorkspace          — this file (Checkpoint A). The provider is APPROVED and its
//                                 RENTAL_COMPANY vertical is draft-authorized (PENDING_REVIEW /
//                                 CHANGES_REQUESTED / APPROVED, per the established C2b-R
//                                 assertRentalDraftAuthorized). An APPROVED-but-non-compliant vertical
//                                 (lapsed publish compliance) STILL gets view/remediation access here.
//   • canMutateDraftConfiguration — Checkpoint B. Each C2b-R mutation already re-checks
//                                 assertRentalDraftAuthorized / assertRentalEditAuthorized in its own
//                                 transaction; the workspace never widens that.
//   • canPublishRentalOffering  — Checkpoint B. Governed per-offering by the stricter
//                                 assertRentalPublishReady (vertical COMPLIANT + vehicle ready + an
//                                 OPEN non-past day) inside publishRentalOffering's transaction.
// null / REJECTED / SUSPENDED vertical, or a non-APPROVED provider → NO access at all.

/** The provider-level VIEW gate. Non-throwing; one bounded vertical-status query. */
export async function canViewRentalWorkspace(provider: { id: string; status: ProviderStatus }): Promise<boolean> {
  if (provider.status !== "APPROVED") return false;
  // Status-based (draftable), NOT compliance-based: an APPROVED-but-non-compliant rental company
  // retains view/remediation access; publish/mutation compliance is enforced separately in C2b-R.
  return (await assertRentalDraftAuthorized(prisma, provider.id)) === null;
}

export type RentalWorkspaceViewDenial = "UNAUTHENTICATED" | "NO_RENTAL_ACCESS";

/**
 * The throwing PAGE gate: resolve the approved session provider, then apply the shared view gate.
 * Returns the session providerId on success; a discriminated denial otherwise. Both a non-approved
 * provider and a provider lacking rental-workspace access collapse to NO_RENTAL_ACCESS — the page
 * maps that to notFound() (the established non-enumerating provider convention: the workspace's
 * existence is never revealed, and no vertical/document/compliance detail leaks). UNAUTHENTICATED is
 * mapped by the page to the login redirect, matching every other provider page.
 */
export async function resolveRentalWorkspaceViewAccess(): Promise<
  { ok: true; providerId: string } | { ok: false; reason: RentalWorkspaceViewDenial }
> {
  let provider: { id: string; status: ProviderStatus };
  try {
    provider = (await requireApprovedProvider()).provider;
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { ok: false, reason: "UNAUTHENTICATED" };
    if (error instanceof ForbiddenError) return { ok: false, reason: "NO_RENTAL_ACCESS" };
    throw error;
  }
  if (!(await canViewRentalWorkspace(provider))) return { ok: false, reason: "NO_RENTAL_ACCESS" };
  return { ok: true, providerId: provider.id };
}
