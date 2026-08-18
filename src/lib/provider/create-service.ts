"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { resolveAssignableCategory } from "@/lib/categories/resolve-assignable-category";
import { isProviderAuthorizedForCategory } from "./activities/assert-provider-authorized-for-category";
import { resolveGuidingContentWrite, type GuidingContentWrite } from "@/lib/tour-template/resolve-guiding-content-write";
import { resolveTouristGuideCategoryId } from "@/lib/tour-template/resolve-tourist-guide-category";
import { DEFAULT_SERVICE_TYPE_KEY } from "@/lib/service-types";
import { parseRegionCode } from "@/lib/regions";
import { parsePricingUnit } from "@/lib/pricing-units";
import { Prisma } from "@prisma/client";
import type { ServiceActionErrorCode } from "./service-action-errors";

// Create Experience — Phase 4.2 (Provider Experience), Priority 1.
// Mirrors create-booking.ts's shape: "use server", requireProvider()
// with the same UnauthenticatedError/ForbiddenError handling, server-
// side re-validation of everything (never trust client input), a
// single $transaction, a stable BookingActionErrorCode-style return.
//
// serviceType is hardcoded to "EXPERIENCE" — the only value this
// codebase's seed data or any query ever uses (confirmed by the
// Phase 4.2 audit); exposing a picker for a discriminator with no
// second real option would be fabricating a choice, not offering one.
//
// A new Service always starts as DRAFT (schema default) with exactly
// one ACTIVE Price created alongside it in the same transaction — a
// service with zero prices can never be published (see
// service-status-policy.ts's NO_ACTIVE_PRICE check on publish), so
// creating one without any price would just produce an unusable draft.
// currency is hardcoded to "OMR" — every Price row in this codebase is
// OMR; there is no multi-currency concept anywhere to expose.

export type CreateServiceResult = { ok: true; serviceId: string } | { ok: false; error: ServiceActionErrorCode };

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

export async function createService(formData: FormData): Promise<CreateServiceResult> {
  const nameAr = formData.get("nameAr");
  const nameEn = formData.get("nameEn");
  const descriptionAr = formData.get("descriptionAr");
  const descriptionEn = formData.get("descriptionEn");
  const priceAmount = formData.get("priceAmount");
  const rawCategoryId = formData.get("categoryId");
  const rawRegionCode = formData.get("regionCode");
  const rawPricingUnit = formData.get("pricingUnit");

  if (typeof nameAr !== "string" || typeof nameEn !== "string" || typeof priceAmount !== "string") {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const trimmedNameAr = nameAr.trim();
  const trimmedNameEn = nameEn.trim();
  const trimmedAmount = priceAmount.trim();

  if (!trimmedNameAr || !trimmedNameEn || !AMOUNT_PATTERN.test(trimmedAmount) || Number(trimmedAmount) <= 0) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const trimmedDescriptionAr = typeof descriptionAr === "string" ? descriptionAr.trim() : "";
  const trimmedDescriptionEn = typeof descriptionEn === "string" ? descriptionEn.trim() : "";

  // Category is optional at create (drafts may stay uncategorized; it is required
  // only at publish).
  const categoryId = typeof rawCategoryId === "string" && rawCategoryId.trim() ? rawCategoryId.trim() : null;

  // Optional discovery/display metadata (Gate 3). Both are validated against
  // their application registries BEFORE any write; empty/absent → null (unset),
  // a governed code → persisted, an invalid non-empty value → INVALID_INPUT (the
  // Gate-4 UI uses dropdowns, so an invalid value here is a malformed/spoofed
  // request, handled by the existing catch-all input error). regionCode lives on
  // the Service; pricingUnit is display metadata on the created Price and does
  // NOT affect totals or booking behaviour.
  const regionCode = parseRegionCode(rawRegionCode);
  if (regionCode === undefined) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  const pricingUnit = parsePricingUnit(rawPricingUnit);
  if (pricingUnit === undefined) {
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

  // serviceType is DERIVED from the selected category (BR-028) — never a client
  // value and never a hardcoded literal. An uncategorized draft defaults to
  // EXPERIENCE until a category is assigned; a category then makes
  // Service.serviceType === Category.serviceTypeKey (server-authoritative).
  let serviceType: string = DEFAULT_SERVICE_TYPE_KEY;
  if (categoryId) {
    const resolved = await resolveAssignableCategory(categoryId);
    if (!resolved) {
      return { ok: false, error: "INVALID_CATEGORY" };
    }
    // Gate B5 — validity is necessary but NOT sufficient: the provider must also
    // be AUTHORIZED for this category (hold a SELF/ADMIN/LEGACY ProviderCategory
    // link). Checked here, after validity, so the two concerns stay distinct and
    // the error is precise. An uncategorized draft (categoryId === null) skips
    // both checks — category is only required at publish.
    if (!(await isProviderAuthorizedForCategory(provider.id, categoryId))) {
      return { ok: false, error: "ACTIVITY_NOT_AUTHORIZED" };
    }
    serviceType = resolved.serviceTypeKey;
  }

  // TOUR-1 — smart tour-guide guidingContent. Ordering is intentional: category
  // validity + B5 authorization above run FIRST; only then is a supplied
  // guidingContent payload checked for eligibility (INDIVIDUAL + tourist-guide
  // category) and parsed by the strict contract. A generic create with no payload
  // skips this entirely and is completely unchanged. The tourist-guide category id
  // is resolved ONLY when a payload is actually supplied.
  const rawGuidingContent = formData.get("guidingContent");
  let guidingWrite: GuidingContentWrite = { kind: "none" };
  if (typeof rawGuidingContent === "string" && rawGuidingContent.trim() !== "") {
    const touristGuideCategoryId = await resolveTouristGuideCategoryId();
    guidingWrite = resolveGuidingContentWrite({
      raw: rawGuidingContent,
      providerType: provider.providerType,
      categoryId,
      touristGuideCategoryId,
    });
    if (guidingWrite.kind === "error") {
      return { ok: false, error: guidingWrite.error };
    }
  }

  try {
    const serviceId = await prisma.$transaction(async (tx) => {
      const service = await tx.service.create({
        data: {
          providerId: provider.id,
          serviceType,
          name: { ar: trimmedNameAr, en: trimmedNameEn },
          description:
            trimmedDescriptionAr || trimmedDescriptionEn
              ? { ar: trimmedDescriptionAr, en: trimmedDescriptionEn }
              : undefined,
          ...(categoryId ? { categoryId } : {}),
          ...(regionCode ? { regionCode } : {}),
        },
      });

      await tx.price.create({
        data: {
          serviceId: service.id,
          amount: trimmedAmount,
          currency: "OMR",
          ...(pricingUnit ? { pricingUnit } : {}),
        },
      });

      if (categoryId) {
        await recordAuditEvent(
          {
            actorType: "PROVIDER",
            actorId: provider.id,
            action: "service.category_assigned",
            entityType: "Service",
            entityId: service.id,
            previousValue: { categoryId: null },
            newValue: { categoryId },
          },
          tx
        );
      }

      // TOUR-1 — persist the normalized guidingContent via the Service<->Experience
      // 1:1 relation, in the SAME transaction as the service/price (atomic: a
      // failed Experience write rolls the whole create back). Experience is created
      // only for an eligible smart-tour service that supplied valid content.
      if (guidingWrite.kind === "set") {
        await tx.experience.create({
          data: {
            serviceId: service.id,
            guidingContent: guidingWrite.value as unknown as Prisma.InputJsonValue,
          },
        });
        await recordAuditEvent(
          {
            actorType: "PROVIDER",
            actorId: provider.id,
            action: "service.tour_content_set",
            entityType: "Service",
            entityId: service.id,
            newValue: { packageType: guidingWrite.value.packageType },
          },
          tx
        );
      }

      return service.id;
    });

    return { ok: true, serviceId };
  } catch (error) {
    logger.error("createService.unexpected_error", {
      providerId: provider.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
