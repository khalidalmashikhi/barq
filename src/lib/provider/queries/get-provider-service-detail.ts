import "server-only";
import { prisma } from "@/lib/db";
import { requireProvider } from "@/lib/auth";
import { extractText } from "@/lib/i18n/extract-text";
import { isValidUuid } from "@/lib/uuid";

// Provider Service Detail query — Provider Dashboard Phase 2 (Service
// Detail Workspace, read-only foundation).
//
// OWNERSHIP/NOT-FOUND, MIRRORING getBookingDetail()'s ESTABLISHED
// CONVENTION: validates serviceId as a UUID before ever querying
// Prisma; resolves provider.id internally via requireProvider() (never
// accepts a providerId parameter); queries by BOTH the service id and
// the authenticated provider.id combined. Returns null uniformly for
// a malformed id, a genuinely missing service, AND a service owned by
// another provider — the caller cannot distinguish these cases, which
// is exactly the point: a uniform response avoids confirming that a
// given service id exists at all to a Provider it doesn't belong to.
//
// PRICE SELECTION: only the current effective ACTIVE price is
// returned. If more than one ACTIVE price exists for a given service
// (an inconsistent-data scenario this query does not attempt to
// repair), the most recently created one wins — orderBy
// createdAt desc, id desc, take 1 — a deterministic tie-break, not an
// arbitrary pick. Price is append-only/versioned in this schema
// (PriceStatus ACTIVE/SUPERSEDED); a future "edit price" flow will
// create a new Price row, not mutate this one, so raw amount/currency
// are included alongside the formatted display string mostly for
// completeness, not because this DTO is what a future edit form would
// write through.
//
// serviceType IS DELIBERATELY OMITTED from this DTO — schema.prisma's
// own comment describes it as "a technical CTI discriminator... not a
// business taxonomy," not a provider-facing concept.

export type ProviderServiceDetail = {
  id: string;
  name: string;
  description: string;
  status: string;
  price: string | null;
  priceAmount: string | null;
  priceCurrency: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function getProviderServiceDetail(serviceId: string): Promise<ProviderServiceDetail | null> {
  if (!isValidUuid(serviceId)) return null;

  const { provider } = await requireProvider();

  const service = await prisma.service.findFirst({
    where: { id: serviceId, providerId: provider.id },
    include: {
      prices: {
        where: { status: "ACTIVE" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
      },
    },
  });

  if (!service) return null;

  type ServiceRow = {
    id: string;
    name: unknown;
    description: unknown;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    prices: Array<{ amount: unknown; currency: string }>;
  };

  const row = service as ServiceRow;
  const activePrice = row.prices[0] ?? null;

  return {
    id: row.id,
    name: extractText(row.name) || "تجربة",
    description: extractText(row.description) || "",
    status: row.status,
    price: activePrice ? `${activePrice.amount} ${activePrice.currency}` : null,
    priceAmount: activePrice ? String(activePrice.amount) : null,
    priceCurrency: activePrice ? activePrice.currency : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
