"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import type { PermissionKey } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { isValidUuid } from "@/lib/uuid";
import type { ProviderVerticalStatus } from "@prisma/client";
import { offeringKindsForVertical, type VerticalErrorCode } from "@/lib/provider/verticals/vertical-policy";
import { assertVerticalApprovable } from "./assert-vertical-approvable";

// Phase 3B — Phase 1. Admin review of provider verticals. Approve/reject/request-changes are
// gated by providers.review; suspend/reactivate by providers.manage (reusing the existing RBAC,
// no new permission). Each transition is STATE-GUARDED (concurrent loser → VERTICAL_STATE_CONFLICT)
// and writes an actor-attributed AuditLog row in the same transaction. Reactivation does NOT
// republish any listing — the provider/admin must explicitly republish after verification.

export type ReviewVerticalResult = { ok: true } | { ok: false; error: VerticalErrorCode };

// Thrown ONLY inside the approval transaction to abort it (rolling back with no transition + no
// audit) when the in-tx compliance re-check fails, carrying the exact code back to the caller.
class VerticalApprovalBlocked extends Error {
  constructor(readonly code: VerticalErrorCode) {
    super(`vertical approval blocked: ${code}`);
    this.name = "VerticalApprovalBlocked";
  }
}

async function transition(opts: {
  verticalId: string;
  permission: PermissionKey;
  allowedFrom: ProviderVerticalStatus[];
  to: ProviderVerticalStatus;
  action: string;
  reason?: string | null;
  setSuspendedAt?: boolean;
  // Suspension only: hide the provider's currently-PUBLISHED listings in this vertical (set them
  // to PAUSED) in the SAME transaction. Reactivation deliberately does NOT reverse this — a
  // provider must explicitly republish after verification (no auto-republish).
  hideListingsForVertical?: boolean;
  // Approval only: fail closed unless every REQUIRED vertical document exists and is APPROVED
  // (ADR-0017, vertical audience). A policy read failure also blocks (no code default for a vertical).
  requireApprovedDocuments?: boolean;
}): Promise<ReviewVerticalResult> {
  const { verticalId, permission, allowedFrom, to, action, reason = null, setSuspendedAt, hideListingsForVertical, requireApprovedDocuments } = opts;
  if (!isValidUuid(verticalId)) return { ok: false, error: "INVALID_INPUT" };

  let actor;
  try {
    const auth = await requirePermission(permission);
    actor = auth.actor;
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/");
    if (error instanceof ForbiddenError) return { ok: false, error: "FORBIDDEN" };
    throw error;
  }

  try {
    const existing = await prisma.providerVertical.findUnique({
      where: { id: verticalId },
      select: { status: true, vertical: true, providerId: true },
    });
    if (!existing) return { ok: false, error: "VERTICAL_NOT_FOUND" };

    const done = await prisma.$transaction(async (tx) => {
      // Phase 3B — Phase 1. APPROVAL fails closed on the vertical's document POLICY + COMPLIANCE
      // (ADR-0017): a configured, non-empty required policy whose every required document exists,
      // is APPROVED, and (when its evidence expires) is unexpired. Re-checked INSIDE this transaction
      // (item 4 — TOCTOU safety) using the SAME tx that performs the state-guarded transition, so a
      // document/policy change between an earlier read and the write cannot slip an approval through.
      if (requireApprovedDocuments) {
        const readiness = await assertVerticalApprovable(existing.providerId, existing.vertical, tx);
        if (!readiness.ready) {
          // Empty/unreadable policy → distinct code; missing/not-approved/expired docs → documents code.
          throw new VerticalApprovalBlocked(
            readiness.reason === "DOCUMENTS_INCOMPLETE" ? "VERTICAL_DOCUMENTS_INCOMPLETE" : "VERTICAL_POLICY_NOT_CONFIGURED"
          );
        }
      }

      const updated = await tx.providerVertical.updateMany({
        where: { id: verticalId, status: { in: allowedFrom } },
        data: {
          status: to,
          reason,
          reviewedAt: new Date(),
          reviewedByAdminId: actor.admin?.id ?? null,
          ...(setSuspendedAt ? { suspendedAt: new Date() } : {}),
          ...(to === "APPROVED" ? { suspendedAt: null } : {}),
        },
      });
      if (updated.count === 0) return false;

      // Suspension enforcement — hide the affected PUBLISHED listings (this vertical only, so
      // unrelated approved verticals' listings are untouched). Bookings are NEVER touched here:
      // existing CONFIRMED/PENDING bookings are preserved (no auto-cancel/refund); hiding the
      // listing only stops NEW bookings, because create-booking requires a PUBLISHED service.
      let hiddenServiceIds: string[] = [];
      if (hideListingsForVertical) {
        const kinds = offeringKindsForVertical(existing.vertical);
        const svcs = await tx.service.findMany({
          where: { providerId: existing.providerId, status: "PUBLISHED", offeringKind: { in: kinds } },
          select: { id: true },
        });
        hiddenServiceIds = svcs.map((s) => s.id);
        if (hiddenServiceIds.length > 0) {
          await tx.service.updateMany({ where: { id: { in: hiddenServiceIds } }, data: { status: "PAUSED" } });
        }
      }

      await recordAuditEvent(
        {
          actorType: actor.actorType,
          actorId: actor.actorId,
          action,
          entityType: "ProviderVertical",
          entityId: verticalId,
          previousValue: { status: existing.status },
          newValue: {
            status: to,
            vertical: existing.vertical,
            reason: reason ?? undefined,
            // The concrete enforcement action taken, recorded in the audit trail.
            ...(hideListingsForVertical ? { hiddenServiceIds } : {}),
          },
        },
        tx
      );
      return true;
    });
    return done ? { ok: true } : { ok: false, error: "VERTICAL_STATE_CONFLICT" };
  } catch (error) {
    // The in-tx compliance re-check aborted the approval — return its exact code (the whole
    // transaction rolled back: no transition, no audit).
    if (error instanceof VerticalApprovalBlocked) return { ok: false, error: error.code };
    logger.error(`${action}.unexpected_error`, { verticalId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}

// NOTE: every export in a "use server" module MUST be async (Next enforces this at build time),
// even the ones that only delegate to the async transition() helper.
export async function approveProviderVertical(verticalId: string): Promise<ReviewVerticalResult> {
  // requireApprovedDocuments — approval fails closed unless the vertical's required documents are all
  // present and APPROVED (reactivate/reject/request-changes deliberately do NOT gate on documents).
  return transition({ verticalId, permission: "providers.review", allowedFrom: ["PENDING_REVIEW", "CHANGES_REQUESTED"], to: "APPROVED", action: "provider_vertical.approved", requireApprovedDocuments: true });
}

export async function rejectProviderVertical(verticalId: string, reasonInput: string): Promise<ReviewVerticalResult> {
  const reason = (reasonInput ?? "").trim();
  if (!reason) return { ok: false, error: "INVALID_INPUT" };
  return transition({ verticalId, permission: "providers.review", allowedFrom: ["PENDING_REVIEW", "CHANGES_REQUESTED"], to: "REJECTED", action: "provider_vertical.rejected", reason });
}

export async function requestProviderVerticalChanges(verticalId: string, reasonInput: string): Promise<ReviewVerticalResult> {
  const reason = (reasonInput ?? "").trim();
  if (!reason) return { ok: false, error: "INVALID_INPUT" };
  return transition({ verticalId, permission: "providers.review", allowedFrom: ["PENDING_REVIEW"], to: "CHANGES_REQUESTED", action: "provider_vertical.changes_requested", reason });
}

export async function suspendProviderVertical(verticalId: string, reasonInput: string): Promise<ReviewVerticalResult> {
  const reason = (reasonInput ?? "").trim();
  if (!reason) return { ok: false, error: "INVALID_INPUT" };
  return transition({ verticalId, permission: "providers.manage", allowedFrom: ["APPROVED"], to: "SUSPENDED", action: "provider_vertical.suspended", reason, setSuspendedAt: true, hideListingsForVertical: true });
}

export async function reactivateProviderVertical(verticalId: string): Promise<ReviewVerticalResult> {
  // Reactivation also reaches APPROVED, so it fails closed on documents too — this prevents a
  // suspend→reactivate path from restoring APPROVED while the vertical's required documents have
  // since lapsed (e.g. were rejected during the suspension). It still does NOT republish listings.
  return transition({ verticalId, permission: "providers.manage", allowedFrom: ["SUSPENDED"], to: "APPROVED", action: "provider_vertical.reactivated", requireApprovedDocuments: true });
}
