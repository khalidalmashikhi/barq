import "server-only";
import { prisma } from "@/lib/db";
import { isValidUuid } from "@/lib/uuid";
import { extractText } from "@/lib/i18n/extract-text";

// Service detail query — Engineering Sprint (Services Marketplace).
//
// "Related services" uses same-provider as the relation, since no
// category/tag field exists to relate by (same gap noted in
// get-services.ts) — a real, defensible relation using existing data,
// not a fabricated one.

export type ServiceDetail = {
  id: string;
  name: string;
  description: string;
  providerId: string;
  providerName: string;
  providerDescription: string;
  price: string | null;
  createdAt: Date;
};

export type RelatedService = {
  id: string;
  name: string;
  providerName: string;
  price: string | null;
};

type ServiceDetailRow = {
  id: string;
  name: unknown;
  description: unknown;
  providerId: string;
  provider: { businessName: unknown; businessDescription: unknown };
  prices: Array<{ amount: unknown; currency: string }>;
  createdAt: Date;
};

export type ActivePriceOption = {
  id: string;
  amount: string;
  currency: string;
};

export async function getActivePricesForService(serviceId: string): Promise<ActivePriceOption[]> {
  if (!isValidUuid(serviceId)) return [];

  const prices = await prisma.price.findMany({
    where: { serviceId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });

  type PriceRow = { id: string; amount: unknown; currency: string };
  return (prices as PriceRow[]).map((price) => ({
    id: price.id,
    amount: String(price.amount),
    currency: price.currency,
  }));
}

export async function getServiceById(id: string): Promise<ServiceDetail | null> {
  if (!isValidUuid(id)) return null;

  const service = await prisma.service.findFirst({
    where: { id, status: "PUBLISHED" },
    include: {
      provider: true,
      prices: { where: { status: "ACTIVE" }, take: 1 },
    },
  });

  if (!service) return null;

  const row = service as ServiceDetailRow;

  return {
    id: row.id,
    name: extractText(row.name) || "تجربة",
    description: extractText(row.description) || "",
    providerId: row.providerId,
    providerName: extractText(row.provider.businessName) || "مزود خدمة",
    providerDescription: extractText(row.provider.businessDescription) || "",
    price: row.prices[0] ? `${row.prices[0].amount} ${row.prices[0].currency}` : null,
    createdAt: row.createdAt,
  };
}

export async function getRelatedServices(serviceId: string, providerId: string): Promise<RelatedService[]> {
  const services = await prisma.service.findMany({
    where: {
      status: "PUBLISHED",
      providerId,
      id: { not: serviceId },
    },
    take: 4,
    orderBy: { createdAt: "desc" },
    include: {
      provider: true,
      prices: { where: { status: "ACTIVE" }, take: 1 },
    },
  });

  return (services as ServiceDetailRow[]).map((service) => ({
    id: service.id,
    name: extractText(service.name) || "تجربة",
    providerName: extractText(service.provider.businessName) || "مزود خدمة",
    price: service.prices[0] ? `${service.prices[0].amount} ${service.prices[0].currency}` : null,
  }));
}
