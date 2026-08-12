"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import type { ServiceActionErrorCode } from "./service-action-errors";

// Duplicate Experience — Phase 4.2 (Provider Experience), Priority 1.
// Clones name, description, serviceType, and the source's current
// ACTIVE price (if any) into a brand-new DRAFT service — a real,
// useful starting point rather than an empty shell, since a service
// with no price can't be published anyway (service-status-policy.ts's
// NO_ACTIVE_PRICE check). The source service is never modified.

export type DuplicateServiceResult = { ok: true; serviceId: string } | { ok: false; error: ServiceActionErrorCode };

export async function duplicateService(serviceId: string): Promise<DuplicateServiceResult> {
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
    const source = await prisma.service.findUnique({
      where: { id: serviceId },
      include: { prices: { where: { status: "ACTIVE" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } },
    });

    if (!source || source.providerId !== provider.id) {
      return { ok: false, error: "SERVICE_NOT_FOUND" };
    }

    const newServiceId = await prisma.$transaction(async (tx) => {
      const created = await tx.service.create({
        data: {
          providerId: provider.id,
          // Faithful clone: copy BOTH serviceType and categoryId from the source
          // so the duplicate preserves the source's consistent serviceType ↔
          // category pair (BR-028). The source is already consistent, so no
          // re-derivation is needed.
          serviceType: source.serviceType,
          ...(source.categoryId ? { categoryId: source.categoryId } : {}),
          name: source.name as object,
          description: source.description === null ? undefined : (source.description as object),
        },
      });

      const sourcePrice = source.prices[0];
      if (sourcePrice) {
        await tx.price.create({
          data: {
            serviceId: created.id,
            amount: sourcePrice.amount,
            currency: sourcePrice.currency,
          },
        });
      }

      return created.id;
    });

    return { ok: true, serviceId: newServiceId };
  } catch (error) {
    logger.error("duplicateService.unexpected_error", {
      serviceId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
