"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { logger } from "@/lib/logger";
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
    const serviceId = await prisma.$transaction(async (tx) => {
      const service = await tx.service.create({
        data: {
          providerId: provider.id,
          serviceType: "EXPERIENCE",
          name: { ar: trimmedNameAr, en: trimmedNameEn },
          description:
            trimmedDescriptionAr || trimmedDescriptionEn
              ? { ar: trimmedDescriptionAr, en: trimmedDescriptionEn }
              : undefined,
        },
      });

      await tx.price.create({
        data: {
          serviceId: service.id,
          amount: trimmedAmount,
          currency: "OMR",
        },
      });

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
