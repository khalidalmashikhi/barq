"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { resolveAssignableCategory } from "@/lib/categories/resolve-assignable-category";
import { parseRegionCode } from "@/lib/regions";
import { parsePricingUnit } from "@/lib/pricing-units";
import type { ServiceAdminActionErrorCode } from "./service-admin-errors";

// Update Service (admin-initiated) — Phase 2.3 (Service Foundation).
// Mirrors src/lib/provider/update-service.ts's validation and field
// scope exactly (only name/description; status changes go through the
// separate transition-service-status.ts actions, price changes are out
// of scope per this phase's DO-NOT list) — no ownership check, since an
// Admin manages every Service, not just one Provider's own. Unlike the
// self-service action (which predates Phase 5.2's audit log system),
// this one audits every call, per this phase's explicit requirement.

export type UpdateServiceResult = { ok: true } | { ok: false; error: ServiceAdminActionErrorCode };

export async function updateService(serviceId: string, formData: FormData): Promise<UpdateServiceResult> {
  if (!isValidUuid(serviceId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const nameAr = formData.get("nameAr");
  const nameEn = formData.get("nameEn");
  const descriptionAr = formData.get("descriptionAr");
  const descriptionEn = formData.get("descriptionEn");
  const rawCategoryId = formData.get("categoryId");
  const rawRegionCode = formData.get("regionCode");
  const rawPricingUnit = formData.get("pricingUnit");

  if (typeof nameAr !== "string" || typeof nameEn !== "string") {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const trimmedNameAr = nameAr.trim();
  const trimmedNameEn = nameEn.trim();

  if (!trimmedNameAr || !trimmedNameEn) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const trimmedDescriptionAr = typeof descriptionAr === "string" ? descriptionAr.trim() : "";
  const trimmedDescriptionEn = typeof descriptionEn === "string" ? descriptionEn.trim() : "";

  // Empty categoryId means "leave unchanged" (non-destructive); explicit
  // un-assignment is out of Task B scope.
  const submittedCategoryId = typeof rawCategoryId === "string" && rawCategoryId.trim() ? rawCategoryId.trim() : null;

  // regionCode + pricingUnit are OPTIONAL/nullable metadata (Gate 3), mirroring the
  // provider update path exactly: an ABSENT form field leaves the value unchanged;
  // a PRESENT-but-empty field clears it to NULL; a governed code sets it; an
  // invalid non-empty value is rejected (INVALID_INPUT) before any write. This
  // differs from categoryId's "empty = leave unchanged" precisely because those
  // fields are freely nullable while a category is required at publish. pricingUnit
  // is display metadata only and never affects totals/booking.
  let regionCodeChange: { regionCode: string | null } | undefined;
  if (rawRegionCode !== null) {
    const parsedRegion = parseRegionCode(rawRegionCode);
    if (parsedRegion === undefined) {
      return { ok: false, error: "INVALID_INPUT" };
    }
    regionCodeChange = { regionCode: parsedRegion };
  }

  let pricingUnitChange: { pricingUnit: string | null } | undefined;
  if (rawPricingUnit !== null) {
    const parsedUnit = parsePricingUnit(rawPricingUnit);
    if (parsedUnit === undefined) {
      return { ok: false, error: "INVALID_INPUT" };
    }
    pricingUnitChange = { pricingUnit: parsedUnit };
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

    // Category only changes when a different, valid category is submitted (empty
    // = leave unchanged, non-destructive). When it changes, serviceType is
    // RE-DERIVED from the new category (BR-028) so the pair stays consistent —
    // the admin path can never produce an inconsistent serviceType ↔ category.
    const categoryChanged = submittedCategoryId !== null && submittedCategoryId !== service.categoryId;
    let derivedServiceType: string | undefined;
    if (categoryChanged) {
      const resolved = await resolveAssignableCategory(submittedCategoryId as string);
      if (!resolved) {
        return { ok: false, error: "INVALID_CATEGORY" };
      }
      derivedServiceType = resolved.serviceTypeKey;
    }

    await prisma.$transaction(async (tx) => {
      await tx.service.update({
        where: { id: serviceId },
        data: {
          name: { ar: trimmedNameAr, en: trimmedNameEn },
          description:
            trimmedDescriptionAr || trimmedDescriptionEn
              ? { ar: trimmedDescriptionAr, en: trimmedDescriptionEn }
              : undefined,
          ...(categoryChanged ? { categoryId: submittedCategoryId, serviceType: derivedServiceType } : {}),
          ...(regionCodeChange ?? {}),
        },
      });

      // pricingUnit is metadata on the Price, set on the current ACTIVE price(s) —
      // a metadata-only update that never touches amount/currency and never inserts
      // a new Price row (append-only versioning preserved, no duplicate ACTIVE
      // price). No-op if the service has no ACTIVE price. Mirrors the provider path.
      if (pricingUnitChange) {
        await tx.price.updateMany({
          where: { serviceId, status: "ACTIVE" },
          data: pricingUnitChange,
        });
      }

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "service.updated",
          entityType: "Service",
          entityId: serviceId,
          previousValue: { name: service.name as object },
          newValue: { name: { ar: trimmedNameAr, en: trimmedNameEn } },
        },
        tx
      );

      if (categoryChanged) {
        await recordAuditEvent(
          {
            actorType: "ADMIN",
            actorId: admin.id,
            action: "service.category_changed",
            entityType: "Service",
            entityId: serviceId,
            previousValue: { categoryId: service.categoryId },
            newValue: { categoryId: submittedCategoryId },
          },
          tx
        );
      }
    });

    return { ok: true };
  } catch (error) {
    logger.error("updateService.unexpected_error", {
      serviceId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
