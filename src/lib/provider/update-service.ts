"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { resolveAssignableCategory } from "@/lib/categories/resolve-assignable-category";
import { parseRegionCode } from "@/lib/regions";
import { parsePricingUnit } from "@/lib/pricing-units";
import type { ServiceActionErrorCode } from "./service-action-errors";

// Edit Experience — Phase 4.2 (Provider Experience), Priority 1.
// Mirrors create-service.ts's validation and cancel-booking.ts's
// ownership-check shape. Only mutates name/description — status
// changes go through the separate transition-service-status.ts
// actions, and price changes are out of this phase's scope (Price is
// append-only/versioned in this schema; a real "edit price" flow would
// insert a new Price row, not mutate this one — a distinct future
// decision, not made here).

export type UpdateServiceResult = { ok: true } | { ok: false; error: ServiceActionErrorCode };

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

  // An empty categoryId means "leave unchanged" — a non-destructive default so a
  // published service is never silently un-categorized through the edit form.
  // Explicit un-assignment is out of Task B scope.
  const submittedCategoryId = typeof rawCategoryId === "string" && rawCategoryId.trim() ? rawCategoryId.trim() : null;

  // regionCode and pricingUnit are OPTIONAL, freely-nullable metadata (Gate 3), so
  // — unlike categoryId, which is required at publish and therefore uses "empty =
  // leave unchanged" — they safely support an explicit CLEAR: an ABSENT form field
  // (formData.get → null) leaves the current value unchanged; a PRESENT-but-empty
  // field clears it to NULL; a present governed code sets it. A present, non-empty,
  // non-governed value is rejected up-front (parse* → undefined) before any write —
  // the Gate-4 UI uses dropdowns, so that path is only a malformed/spoofed request.
  // Both are validated here, before the transaction, so nothing is mutated on a bad
  // value. pricingUnit is display metadata only and never affects totals/booking.
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

    // Category only changes when a different, valid category is submitted. An
    // empty categoryId means "leave unchanged" (non-destructive — the service is
    // never silently un-categorized), so serviceType is never orphaned. When the
    // category DOES change, serviceType is RE-DERIVED from the new category
    // (BR-028) so the pair stays consistent (Service.serviceType ===
    // Category.serviceTypeKey) — never trusting the existing serviceType.
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

      // pricingUnit is metadata ON the Price, not the Service. Set it on the
      // current ACTIVE price(s) — a metadata-only update that never touches
      // amount/currency and never inserts a new Price row, so the append-only
      // price-versioning model is preserved and no duplicate ACTIVE price is
      // created. The reader selects amount + currency + pricingUnit from the same
      // ACTIVE row, so they stay consistent. If the service has no ACTIVE price
      // (e.g. an admin-provisioned draft), updateMany matches nothing — a safe
      // no-op, since a unit with no price has nowhere to live yet.
      if (pricingUnitChange) {
        await tx.price.updateMany({
          where: { serviceId, status: "ACTIVE" },
          data: pricingUnitChange,
        });
      }

      if (categoryChanged) {
        await recordAuditEvent(
          {
            actorType: "PROVIDER",
            actorId: provider.id,
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
