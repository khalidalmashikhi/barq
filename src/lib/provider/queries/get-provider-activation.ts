import "server-only";
import { prisma } from "@/lib/db";
import { requireProvider } from "@/lib/auth";
import { requiredDocumentTypesFor } from "@/lib/provider-document-types";
import { deriveProviderActivation, type ProviderActivation } from "@/lib/provider/activation/derive-provider-activation";

// Provider activation loader — gathers the REAL signals the first-run checklist
// needs (all already-existing data), then hands them to the pure
// deriveProviderActivation(). Self-resolving provider identity via
// requireProvider() (same trust model as the other provider queries). No new
// tables, no mutation. profileComplete is an honest signal: the provider has
// filled the optional contact fields they set on /provider/settings.

export type ProviderActivationResult = ProviderActivation & {
  providerType: string;
};

export async function getProviderActivation(): Promise<ProviderActivationResult> {
  const { provider } = await requireProvider();
  const providerId = provider.id;

  const required = requiredDocumentTypesFor({ providerType: provider.providerType });

  const [totalServicesCount, publishedServicesCount, approvedRequiredTypes, profileRow] = await Promise.all([
    prisma.service.count({ where: { providerId } }),
    prisma.service.count({ where: { providerId, status: "PUBLISHED" } }),
    required.length === 0
      ? Promise.resolve([] as { type: string }[])
      : prisma.providerDocument.findMany({
          where: { providerId, type: { in: required }, status: "APPROVED" },
          select: { type: true },
          distinct: ["type"],
        }),
    prisma.provider.findUnique({ where: { id: providerId }, select: { contactEmail: true, city: true } }),
  ]);

  const profileComplete = Boolean(profileRow?.contactEmail && profileRow?.city);

  const activation = deriveProviderActivation({
    providerStatus: provider.status,
    profileComplete,
    verificationRequiredTotal: required.length,
    verificationRequiredApproved: approvedRequiredTypes.length,
    totalServicesCount,
    publishedServicesCount,
  });

  return { ...activation, providerType: provider.providerType };
}
