"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { resolveAssignableCategory } from "@/lib/categories/resolve-assignable-category";
import { DEFAULT_SERVICE_TYPE_KEY } from "@/lib/service-types";
import type { ServiceAdminActionErrorCode } from "./service-admin-errors";

// Create Service (admin-initiated) — Phase 2.3 (Service Foundation).
// Mirrors create-provider.ts's shape. Distinct from the pre-existing
// self-service create-service.ts (src/lib/provider/): that flow lets an
// already-approved Provider create a service for themselves, always
// bundled with an initial ACTIVE Price; this one lets an Admin directly
// provision a Service for an existing Provider (found by id) — e.g.
// pre-populating a partner's catalog before they onboard.
//
// serviceType is hardcoded to "EXPERIENCE", same reasoning as the
// self-service action: it is the only value this codebase ever uses,
// confirmed by the Phase 4.2 audit and unchanged since.
//
// NO PRICE FIELD — deliberately. This phase's own scope explicitly
// excludes Pricing Rules. An admin-created service therefore starts
// DRAFT with zero prices, same schema default as self-service; if an
// admin later attempts to Publish it, publishService() correctly
// returns NO_ACTIVE_PRICE — the exact same business rule the
// self-service path enforces, reused rather than bypassed. Assigning a
// price to an admin-created service is a future Pricing phase's job.

export type CreateServiceResult = { ok: true; serviceId: string } | { ok: false; error: ServiceAdminActionErrorCode };

export async function createService(formData: FormData): Promise<CreateServiceResult> {
  const providerId = formData.get("providerId");
  const nameAr = formData.get("nameAr");
  const nameEn = formData.get("nameEn");
  const descriptionAr = formData.get("descriptionAr");
  const descriptionEn = formData.get("descriptionEn");
  const rawCategoryId = formData.get("categoryId");

  if (typeof providerId !== "string" || typeof nameAr !== "string" || typeof nameEn !== "string") {
    return { ok: false, error: "INVALID_INPUT" };
  }

  if (!isValidUuid(providerId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const trimmedNameAr = nameAr.trim();
  const trimmedNameEn = nameEn.trim();

  if (!trimmedNameAr || !trimmedNameEn) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const trimmedDescriptionAr = typeof descriptionAr === "string" ? descriptionAr.trim() : "";
  const trimmedDescriptionEn = typeof descriptionEn === "string" ? descriptionEn.trim() : "";

  // Category optional at create, required at publish.
  const categoryId = typeof rawCategoryId === "string" && rawCategoryId.trim() ? rawCategoryId.trim() : null;

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
    const provider = await prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) {
      return { ok: false, error: "PROVIDER_NOT_FOUND" };
    }

    // serviceType is DERIVED from the category (BR-028) — the admin path enforces
    // the SAME invariant as self-service; uncategorized draft defaults to
    // EXPERIENCE until a category is assigned.
    let serviceType: string = DEFAULT_SERVICE_TYPE_KEY;
    if (categoryId) {
      const resolved = await resolveAssignableCategory(categoryId);
      if (!resolved) {
        return { ok: false, error: "INVALID_CATEGORY" };
      }
      serviceType = resolved.serviceTypeKey;
    }

    const serviceId = await prisma.$transaction(async (tx) => {
      const service = await tx.service.create({
        data: {
          providerId,
          serviceType,
          name: { ar: trimmedNameAr, en: trimmedNameEn },
          description:
            trimmedDescriptionAr || trimmedDescriptionEn
              ? { ar: trimmedDescriptionAr, en: trimmedDescriptionEn }
              : undefined,
          ...(categoryId ? { categoryId } : {}),
        },
      });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "service.created",
          entityType: "Service",
          entityId: service.id,
          newValue: {
            providerId,
            name: { ar: trimmedNameAr, en: trimmedNameEn },
            status: "DRAFT",
          },
        },
        tx
      );

      if (categoryId) {
        await recordAuditEvent(
          {
            actorType: "ADMIN",
            actorId: admin.id,
            action: "service.category_assigned",
            entityType: "Service",
            entityId: service.id,
            previousValue: { categoryId: null },
            newValue: { categoryId },
          },
          tx
        );
      }

      return service.id;
    });

    return { ok: true, serviceId };
  } catch (error) {
    logger.error("createService.unexpected_error", {
      adminId: admin.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
