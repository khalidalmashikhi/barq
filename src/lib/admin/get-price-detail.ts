import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";

// Admin Price detail query — Phase 2.5 (Pricing Foundation). Mirrors
// get-service-detail.ts's (admin) shape: locale-extracted serviceName
// for read-only display context, raw fields otherwise.

export type PriceDetail = {
  id: string;
  serviceId: string;
  serviceName: string;
  amount: string;
  currency: string;
  /// Raw governed unit CODE or null (legacy) — lets the update form pre-fill the pricing basis.
  pricingUnit: string | null;
  status: string;
  createdAt: Date;
} | null;

export async function getPriceDetail(priceId: string): Promise<PriceDetail> {
  await requireAdmin();

  if (!isValidUuid(priceId)) {
    return null;
  }

  const locale = await getLocale();

  const price = await prisma.price.findUnique({
    where: { id: priceId },
    include: { service: true },
  });

  if (!price) {
    return null;
  }

  return {
    id: price.id,
    serviceId: price.serviceId,
    serviceName: extractLocalizedText(price.service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
    amount: String(price.amount),
    currency: price.currency,
    pricingUnit: price.pricingUnit ?? null,
    status: price.status,
    createdAt: price.createdAt,
  };
}
