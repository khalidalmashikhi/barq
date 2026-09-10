"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { ProviderVerticalType } from "@prisma/client";
import { canProviderRequestVertical, type VerticalErrorCode } from "./vertical-policy";

// Phase 3B — Phase 1. A provider REQUESTS a regulated vertical (creates a PENDING_REVIEW row,
// origin PROVIDER_REQUEST). A CHANGES_REQUESTED / REJECTED vertical can be corrected and
// resubmitted (→ PENDING_REVIEW). Never approves; approval is admin-only. Concurrency-safe via
// the (providerId, vertical) unique constraint.
//
// ONBOARDING SEPARATION (Blocker 2): a provider may request a vertical DURING onboarding — this uses
// requireProvider() (not requireApprovedProvider), then an explicit account-status eligibility check
// (canProviderRequestVertical). requireProvider already rejects SUSPENDED/DEACTIVATED; the extra
// check additionally rejects REJECTED. Main-account approval stays separate; PUBLISHING still needs
// BOTH the Provider = APPROVED (enforced by publish's requireApprovedProvider) and the vertical =
// APPROVED. Ownership/authentication are never weakened.

const VALID_VERTICALS: readonly ProviderVerticalType[] = ["TOURIST_GUIDE", "RENTAL_COMPANY"];

export type RequestVerticalResult =
  | { ok: true; outcome: "requested" | "resubmitted" | "already_pending" }
  | { ok: false; error: VerticalErrorCode };

export async function requestProviderVertical(verticalInput: string): Promise<RequestVerticalResult> {
  const vertical = VALID_VERTICALS.find((v) => v === verticalInput);
  if (!vertical) return { ok: false, error: "INVALID_VERTICAL" };

  let providerId: string;
  try {
    const auth = await requireProvider();
    // Onboarding-eligible account states may request; REJECTED (and any future non-eligible state)
    // is refused here. SUSPENDED/DEACTIVATED never reach this point (requireProvider throws first).
    if (!canProviderRequestVertical(auth.provider.status)) {
      return { ok: false, error: "PROVIDER_NOT_ELIGIBLE" };
    }
    providerId = auth.provider.id;
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/");
    // requireProvider throws ForbiddenError for a missing profile or a SUSPENDED/DEACTIVATED account.
    if (error instanceof ForbiddenError) {
      return { ok: false, error: error.code === "PROVIDER_DEACTIVATED" ? "PROVIDER_NOT_ELIGIBLE" : "NO_PROVIDER_PROFILE" };
    }
    throw error;
  }

  try {
    const existing = await prisma.providerVertical.findUnique({
      where: { providerId_vertical: { providerId, vertical } },
      select: { id: true, status: true },
    });

    if (existing) {
      if (existing.status === "APPROVED") return { ok: false, error: "VERTICAL_ALREADY_EXISTS" };
      if (existing.status === "SUSPENDED") return { ok: false, error: "VERTICAL_REJECTED_OR_SUSPENDED" };
      if (existing.status === "PENDING_REVIEW") return { ok: true, outcome: "already_pending" };
      // CHANGES_REQUESTED / REJECTED → resubmit (state-guarded so a concurrent admin decision wins).
      const done = await prisma.$transaction(async (tx) => {
        const updated = await tx.providerVertical.updateMany({
          where: { id: existing.id, status: { in: ["CHANGES_REQUESTED", "REJECTED"] } },
          data: { status: "PENDING_REVIEW", reason: null, requestedAt: new Date(), reviewedAt: null, reviewedByAdminId: null },
        });
        if (updated.count === 0) return false;
        await recordAuditEvent(
          {
            actorType: "PROVIDER",
            actorId: providerId,
            action: "provider_vertical.resubmitted",
            entityType: "ProviderVertical",
            entityId: existing.id,
            previousValue: { status: existing.status },
            newValue: { status: "PENDING_REVIEW", vertical },
          },
          tx
        );
        return true;
      });
      return done ? { ok: true, outcome: "resubmitted" } : { ok: true, outcome: "already_pending" };
    }

    await prisma.$transaction(async (tx) => {
      const row = await tx.providerVertical.create({
        data: { providerId, vertical, status: "PENDING_REVIEW", origin: "PROVIDER_REQUEST" },
      });
      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: providerId,
          action: "provider_vertical.requested",
          entityType: "ProviderVertical",
          entityId: row.id,
          newValue: { status: "PENDING_REVIEW", vertical, origin: "PROVIDER_REQUEST" },
        },
        tx
      );
    });
    return { ok: true, outcome: "requested" };
  } catch (error) {
    // A concurrent duplicate request loses the (providerId, vertical) unique race → already requested.
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
      return { ok: true, outcome: "already_pending" };
    }
    logger.error("requestProviderVertical.unexpected_error", { message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
