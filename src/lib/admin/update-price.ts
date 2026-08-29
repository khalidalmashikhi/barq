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

// Update Price (admin-initiated) — Phase 2.5 (Pricing Foundation). The
// "change an existing price" half of the same real gap create-price.ts
// fills. Price is append-only/versioned (PriceStatus ACTIVE/SUPERSEDED)
// — this never mutates amount/currency on the existing row. Instead, in
// one transaction, it marks the current ACTIVE price SUPERSEDED and
// creates a brand-new ACTIVE Price row with the new amount, preserving
// the exact versioning semantics every existing comment already
// documented as the correct future design. Requires an existing ACTIVE
// price (NO_ACTIVE_PRICE otherwise, directing the caller to
// createPrice() instead) — same single-active-price invariant
// create-price.ts enforces from its side.
//
// A Booking's own priceSnapshotAmount/priceSnapshotCurrency
// (create-booking.ts) already captures the amount at booking time, so
// superseding a price here never retroactively changes an existing
// booking's charged amount — only which price new bookings see.

export type UpdatePriceResult = { ok: true; priceId: string } | { ok: false; error: PriceAdminActionErrorCode };

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

export async function updatePrice(serviceId: string, formData: FormData): Promise<UpdatePriceResult> {
  if (!isValidUuid(serviceId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const amount = formData.get("amount");
  if (typeof amount !== "string") {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const trimmedAmount = amount.trim();
  if (!AMOUNT_PATTERN.test(trimmedAmount) || Number(trimmedAmount) <= 0) {
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
    const currentActive = await prisma.price.findFirst({ where: { serviceId, status: "ACTIVE" } });
    if (!currentActive) {
      return { ok: false, error: "NO_ACTIVE_PRICE" };
    }

    // PRICING UNIT DATA INTEGRITY — the NEW ACTIVE (superseding) price must carry a governed,
    // BOOKABLE unit. An explicitly-submitted unit wins (this is also how an admin FIXES a
    // legacy NULL-unit price — supersede it with a real unit); otherwise the current active's
    // unit is carried over. An unknown submitted code, or a resulting NULL / duration unit, is
    // rejected — the superseding price is never created unbookable (previously it dropped to NULL).
    const submittedUnit = parsePricingUnit(formData.get("pricingUnit"));
    if (submittedUnit === undefined) {
      return { ok: false, error: "PRICING_UNIT_REQUIRED" };
    }
    const resolvedUnit = submittedUnit ?? currentActive.pricingUnit;
    if (!isBookablePricingUnit(resolvedUnit)) {
      return { ok: false, error: "PRICING_UNIT_REQUIRED" };
    }

    const newPriceId = await prisma.$transaction(async (tx) => {
      await tx.price.update({ where: { id: currentActive.id }, data: { status: "SUPERSEDED" } });

      const newPrice = await tx.price.create({
        data: {
          serviceId,
          amount: trimmedAmount,
          currency: currentActive.currency,
          pricingUnit: resolvedUnit,
        },
      });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "price.updated",
          entityType: "Price",
          entityId: newPrice.id,
          previousValue: { supersededPriceId: currentActive.id, amount: String(currentActive.amount) },
          newValue: { serviceId, amount: trimmedAmount, currency: currentActive.currency, pricingUnit: resolvedUnit, status: "ACTIVE" },
        },
        tx
      );

      return newPrice.id;
    });

    return { ok: true, priceId: newPriceId };
  } catch (error) {
    logger.error("updatePrice.unexpected_error", {
      serviceId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
