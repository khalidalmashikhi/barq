import "server-only";
import { prisma } from "@/lib/db";
import type { ProviderMediaErrorCode } from "@/lib/provider/media/provider-media-errors";

// Service media ownership gate (Media Foundation, Gap C). A provider may
// mutate media ONLY for services they own — enforced server-side here, never
// trusted from the request. Returns null when the caller owns the service,
// or the exact error code otherwise (NOT_FOUND for a missing service,
// FORBIDDEN for someone else's).

export async function assertServiceOwnership(
  serviceId: string,
  providerId: string
): Promise<ProviderMediaErrorCode | null> {
  const service = await prisma.service.findUnique({ where: { id: serviceId }, select: { providerId: true } });
  if (!service) return "NOT_FOUND";
  if (service.providerId !== providerId) return "FORBIDDEN";
  return null;
}
