import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";

// Admin Homepage Section detail query — Phase 1.4 (Core Business
// Platform). Mirrors get-feature-flag-detail.ts's shape — feeds the edit
// form.

export type HomepageSectionDetail = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  visible: boolean;
  sortOrder: number;
} | null;

export async function getHomepageSectionDetail(sectionId: string): Promise<HomepageSectionDetail> {
  await requireAdmin();

  if (!isValidUuid(sectionId)) {
    return null;
  }

  const section = await prisma.homepageSection.findUnique({ where: { id: sectionId } });

  if (!section) {
    return null;
  }

  return {
    id: section.id,
    key: section.key,
    label: section.label,
    description: section.description,
    visible: section.visible,
    sortOrder: section.sortOrder,
  };
}
