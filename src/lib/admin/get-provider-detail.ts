import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";

// Admin Provider detail query — Phase 2 (Provider Foundation). Returns
// raw bilingual Json (not locale-extracted) since this feeds an admin
// edit form that needs both languages simultaneously — same
// distinction get-category-detail.ts already draws against
// get-categories.ts's list view.

export type ProviderDetail = {
  id: string;
  userId: string;
  businessName: { ar: string; en: string };
  businessDescription: { ar: string; en: string } | null;
  slug: string | null;
  status: string;
  visible: boolean;
  contactEmail: string | null;
  city: string | null;
  logoUrl: string | null;
  approvedAt: Date | null;
  approvedByAdminId: string | null;
  createdAt: Date;
  updatedAt: Date;
} | null;

export async function getProviderDetail(providerId: string): Promise<ProviderDetail> {
  await requireAdmin();

  if (!isValidUuid(providerId)) {
    return null;
  }

  const provider = await prisma.provider.findUnique({ where: { id: providerId } });

  if (!provider) {
    return null;
  }

  return {
    id: provider.id,
    userId: provider.userId,
    businessName: provider.businessName as { ar: string; en: string },
    businessDescription: provider.businessDescription as { ar: string; en: string } | null,
    slug: provider.slug,
    status: provider.status,
    visible: provider.visible,
    contactEmail: provider.contactEmail,
    city: provider.city,
    logoUrl: provider.logoUrl,
    approvedAt: provider.approvedAt,
    approvedByAdminId: provider.approvedByAdminId,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}
