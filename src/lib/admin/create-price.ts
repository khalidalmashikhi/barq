"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { parsePricingUnit } from "@/lib/pricing-units";
import { isBookablePricingUnit } from "@/lib/pricing-units/billability";
import type { PriceAdminActionErrorCode } from "./price-admin-errors";

// Create Price (admin-initiated) — Phase 2.5 (Pricing Foundation).
// Fills a real, previously-deferred gap: every existing comment across
// create-service.ts, update-service.ts, and get-provider-service-detail.ts
// says a dedicated price-change flow would create a new Price row rather
// than mutate one, since Price is append-only/versioned
// (PriceStatus ACTIVE/SUPERSEDED) — none of them ever built it. This is
// that flow's "first price" half: it requires the service to have NO
// current ACTIVE price (PRICE_ALREADY_ACTIVE otherwise, directing the
// caller to updatePrice() instead) — this keeps the single-effective-
// active-price-per-service invariant every existing query already
// assumes (see get-provider-service-detail.ts's own "if more than one
// ACTIVE price exists... arbitrary pick" comment) enforced at the one
// place prices are actually created, rather than merely hoped for.
//
// currency is hardcoded to "OMR", same reasoning as create-service.ts's
// own hardcoded currency — no multi-currency concept exists anywhere in
// this codebase to expose a real choice for.

export type CreatePriceResult = { ok: true; priceId: string } | { ok: false; error: PriceAdminActionErrorCode };

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

export async function createPrice(formData: FormData): Promise<CreatePriceResult> {
  const serviceId = formData.get("serviceId");
  const amount = formData.get("amount");

  if (typeof serviceId !== "string" || typeof amount !== "string") {
    return { ok: false, error: "INVALID_INPUT" };
  }

  if (!isValidUuid(serviceId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const trimmedAmount = amount.trim();
  if (!AMOUNT_PATTERN.test(trimmedAmount) || Number(trimmedAmount) <= 0) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  // PRICING UNIT DATA INTEGRITY — a new ACTIVE price must carry a governed, BOOKABLE unit.
  // (Previously admin prices were created with NULL pricingUnit, which is now unbookable.)
  const pricingUnit = parsePricingUnit(formData.get("pricingUnit"));
  if (!isBookablePricingUnit(pricingUnit)) {
    return { ok: false, error: "PRICING_UNIT_REQUIRED" };
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

    const existingActive = await prisma.price.findFirst({ where: { serviceId, status: "ACTIVE" } });
    if (existingActive) {
      return { ok: false, error: "PRICE_ALREADY_ACTIVE" };
    }

    const priceId = await prisma.$transaction(async (tx) => {
      const price = await tx.price.create({
        data: {
          serviceId,
          amount: trimmedAmount,
          currency: "OMR",
          pricingUnit,
        },
      });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "price.created",
          entityType: "Price",
          entityId: price.id,
          newValue: { serviceId, amount: trimmedAmount, currency: "OMR", pricingUnit, status: "ACTIVE" },
        },
        tx
      );

      return price.id;
    });

    return { ok: true, priceId };
  } catch (error) {
    logger.error("createPrice.unexpected_error", {
      adminId: admin.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
