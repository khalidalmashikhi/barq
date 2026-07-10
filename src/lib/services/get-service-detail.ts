import "server-only";
import { prisma } from "@/lib/db";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

// Service detail query â€” Engineering Sprint (Services Marketplace).
//
// "Related services" uses same-provider as the relation, since no
// category/tag field exists to relate by (same gap noted in
// get-services.ts) â€” a real, defensible relation using existing data,
// not a fabricated one.

function extractText(value: unknown): string {
  if (value && typeof value === "object" && "ar" in value) {
    const ar = (value as { ar?: unknown }).ar;
    if (typeof ar === "string") return ar;
  }
  return "";
}

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

export async function getServiceById(id: string): Promise<ServiceDetail | null> {
  if (!isUuid(id)) {
    return null;
  }

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
    name: extractText(row.name) || "ØªØ¬Ø±Ø¨Ø©",
    description: extractText(row.description) || "",
    providerId: row.providerId,
    providerName: extractText(row.provider.businessName) || "Ù…Ø²ÙˆØ¯ Ø®Ø¯Ù…Ø©",
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
    name: extractText(service.name) || "ØªØ¬Ø±Ø¨Ø©",
    providerName: extractText(service.provider.businessName) || "Ù…Ø²ÙˆØ¯ Ø®Ø¯Ù…Ø©",
    price: service.prices[0] ? `${service.prices[0].amount} ${service.prices[0].currency}` : null,
  }));
}


