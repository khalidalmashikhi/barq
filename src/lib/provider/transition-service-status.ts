"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { canPublishService, canUnpublishService, canArchiveService } from "@/lib/services/service-status-policy";
import { assertServicePublishable, type ServicePublishBlocker } from "@/lib/services/assert-service-publishable";
import { isProviderAuthorizedForCategory } from "./activities/assert-provider-authorized-for-category";
import { resolveTouristGuideCategoryId } from "@/lib/tour-template/resolve-tourist-guide-category";
import { isSmartTourGuideEligible } from "@/lib/tour-template/eligibility";
import { parseGuidingContent } from "@/lib/tour-template/guiding-content";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { ServiceActionErrorCode } from "./service-action-errors";
import type { ServiceStatus } from "@prisma/client";

const AUDIT_ACTION_BY_STATUS: Record<ServiceStatus, string> = {
  DRAFT: "service.reverted_to_draft",
  PUBLISHED: "service.published",
  PAUSED: "service.unpublished",
  ARCHIVED: "service.archived",
};

// Publish / Unpublish / Archive — Phase 4.2 (Provider Experience),
// Priority 1. Three thin actions sharing one internal transition
// helper, mirroring accept-booking.ts/reject-booking.ts's exact shape
// (UUID validation, requireProvider(), ownership re-check, a named
// policy check from service-status-policy.ts, generic catch).
//
// Publishing requires at least one ACTIVE Price to exist — the one
// real business rule beyond the plain status graph: a published
// experience with no price is unbookable (create-booking.ts requires
// an ACTIVE Price to create a booking at all), so publish would
// otherwise produce a dead end a customer could reach but never book.

export type TransitionServiceResult =
  | { ok: true }
  | { ok: false; error: ServiceActionErrorCode; blockers?: ServicePublishBlocker[] };

async function transition(
  serviceId: string,
  toStatus: ServiceStatus,
  canTransition: (status: string) => boolean
): Promise<TransitionServiceResult> {
  if (!isValidUuid(serviceId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  let provider;
  try {
    const auth = await requireApprovedProvider();
    provider = auth.provider;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/");
    }
    if (error instanceof ForbiddenError) {
      return { ok: false, error: error.code === "PROVIDER_NOT_APPROVED" ? "PROVIDER_NOT_APPROVED" : "NO_PROVIDER_PROFILE" };
    }
    throw error;
  }

  try {
    const service = await prisma.service.findUnique({ where: { id: serviceId } });

    if (!service || service.providerId !== provider.id) {
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

      // Gate B5 — the customer-facing gate: a provider may only publish (or
      // republish PAUSED → PUBLISHED) a service whose CURRENT category they are
      // authorized for. This intentionally lives in the PROVIDER action, NOT in
      // the shared assertServicePublishable(): the admin transition uses the same
      // publishable policy but is governance and is deliberately exempt from
      // provider authorization. After the blockers pass, categoryId is guaranteed
      // present (SERVICE_CATEGORY_REQUIRED would have fired) — the guard is
      // defensive.
      if (service.categoryId && !(await isProviderAuthorizedForCategory(provider.id, service.categoryId))) {
        return { ok: false, error: "ACTIVITY_NOT_AUTHORIZED" };
      }

      // TOUR-1 — an eligible smart-tour service must not be published/republished
      // without valid guidingContent. Provider-only (the admin transition uses the
      // same publishable policy but is governance and stays exempt, like B5).
      const touristGuideCategoryId = await resolveTouristGuideCategoryId();
      if (
        isSmartTourGuideEligible({
          providerType: provider.providerType,
          categoryId: service.categoryId,
          touristGuideCategoryId,
        })
      ) {
        const experience = await prisma.experience.findUnique({
          where: { serviceId: service.id },
          select: { guidingContent: true },
        });
        if (!experience || experience.guidingContent === null) {
          return { ok: false, error: "TOUR_TEMPLATE_REQUIRED" };
        }
        if (!parseGuidingContent(experience.guidingContent).ok) {
          return { ok: false, error: "TOUR_TEMPLATE_INVALID" };
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.service.update({ where: { id: serviceId }, data: { status: toStatus } });

      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: provider.id,
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
