"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { canPublishService, canUnpublishService, canArchiveService } from "@/lib/services/service-status-policy";
import { assertServicePublishable, type ServicePublishBlocker } from "@/lib/services/assert-service-publishable";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { ServiceAdminActionErrorCode } from "./service-admin-errors";
import type { ServiceStatus } from "@prisma/client";

// Publish / Unpublish / Archive (admin-initiated) — Phase 2.3 (Service
// Foundation). Mirrors src/lib/provider/transition-service-status.ts's
// exact shape (shared internal transition() helper, one named policy
// check per call from the existing, untouched service-status-policy.ts
// — the same lifecycle, not a redesigned one) with two differences:
// requireAdmin() instead of requireApprovedProvider(), and no ownership
// re-check, since an Admin may transition any Service, not just one
// Provider's own. Also covers this phase's "Archive" capability — same
// shared helper's third branch, exactly as the self-service module
// already does, not a separate action.
//
// Publishing still requires at least one ACTIVE Price — the same
// NO_ACTIVE_PRICE business rule enforced for provider self-service,
// reused verbatim rather than relaxed for admin.

const AUDIT_ACTION_BY_STATUS: Record<ServiceStatus, string> = {
  DRAFT: "service.reverted_to_draft",
  PUBLISHED: "service.published",
  PAUSED: "service.unpublished",
  ARCHIVED: "service.archived",
};

export type TransitionServiceResult =
  | { ok: true }
  | { ok: false; error: ServiceAdminActionErrorCode; blockers?: ServicePublishBlocker[] };

async function transition(
  serviceId: string,
  toStatus: ServiceStatus,
  canTransition: (status: string) => boolean
): Promise<TransitionServiceResult> {
  if (!isValidUuid(serviceId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  let admin;
  try {
    const auth = await requireAdmin();
    admin = auth.admin;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/");
    }
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "NO_ADMIN_PROFILE" };
    }
    throw error;
  }

  try {
    const service = await prisma.service.findUnique({ where: { id: serviceId } });

    if (!service) {
      return { ok: false, error: "SERVICE_NOT_FOUND" };
    }

    if (!canTransition(service.status)) {
      return { ok: false, error: "INVALID_STATUS_TRANSITION" };
    }

    if (toStatus === "PUBLISHED") {
      // Single source of publish gating (BR-026 category + active price),
      // returning ALL blockers in priority order so the UI can show them at once.
      const blockers = await assertServicePublishable({ id: service.id, categoryId: service.categoryId });
      const [primaryBlocker] = blockers;
      if (primaryBlocker) {
        return { ok: false, error: primaryBlocker, blockers };
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.service.update({ where: { id: serviceId }, data: { status: toStatus } });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: AUDIT_ACTION_BY_STATUS[toStatus],
          entityType: "Service",
          entityId: serviceId,
          previousValue: { status: service.status },
          newValue: { status: toStatus },
        },
        tx
      );
    });

    return { ok: true };
  } catch (error) {
    logger.error("transitionServiceStatus.unexpected_error", {
      serviceId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}

export async function publishService(serviceId: string): Promise<TransitionServiceResult> {
  return transition(serviceId, "PUBLISHED", canPublishService);
}

export async function unpublishService(serviceId: string): Promise<TransitionServiceResult> {
  return transition(serviceId, "PAUSED", canUnpublishService);
}

export async function archiveService(serviceId: string): Promise<TransitionServiceResult> {
  return transition(serviceId, "ARCHIVED", canArchiveService);
}
