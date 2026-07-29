"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { PriceAdminActionErrorCode } from "./price-admin-errors";

// Deactivate Price (admin-initiated) — Phase 2.5 (Pricing Foundation).
// Maps this phase's requested "Archive / Deactivate Price" capability
// onto the existing PriceStatus enum's SUPERSEDED value — the enum is
// kept unchanged, not extended, since it already models exactly this
// one-way transition. Deliberately one-way, mirroring
// Service/Category/Provider's own terminal-state precedent: this ends
// the price with no replacement (a service can validly have zero ACTIVE
// prices — service-status-policy.ts's NO_ACTIVE_PRICE check already
// handles that at publish time), refusing if the target isn't currently
// ACTIVE. No "reactivate" action exists, deliberately: nothing in this
// schema records which price (if any) superseded a given row, so
// reactivating an old SUPERSEDED price could silently create a second
// ACTIVE price for the same service — the exact invariant
// create-price.ts/update-price.ts exist to prevent. Redesigning that
// would mean redesigning the versioning model itself, out of this
// phase's explicit scope.

export type DeactivatePriceResult = { ok: true } | { ok: false; error: PriceAdminActionErrorCode };

export async function deactivatePrice(priceId: string): Promise<DeactivatePriceResult> {
  if (!isValidUuid(priceId)) {
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
    const price = await prisma.price.findUnique({ where: { id: priceId } });

    if (!price) {
      return { ok: false, error: "PRICE_NOT_FOUND" };
    }

    if (price.status !== "ACTIVE") {
      return { ok: false, error: "NO_ACTIVE_PRICE" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.price.update({ where: { id: priceId }, data: { status: "SUPERSEDED" } });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "price.deactivated",
          entityType: "Price",
          entityId: priceId,
          previousValue: { status: "ACTIVE" },
          newValue: { status: "SUPERSEDED" },
        },
        tx
      );
    });

    return { ok: true };
  } catch (error) {
    logger.error("deactivatePrice.unexpected_error", {
      priceId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
