import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";

// Admin Feature Flag detail query — Phase 1.3 (Core Business Platform).
// Mirrors get-category-detail.ts's shape — feeds the edit form.

export type FeatureFlagDetail = {
  id: string;
  key: string;
  enabled: boolean;
  description: string | null;
} | null;

export async function getFeatureFlagDetail(flagId: string): Promise<FeatureFlagDetail> {
  await requireAdmin();

  if (!isValidUuid(flagId)) {
    return null;
  }

  const flag = await prisma.featureFlag.findUnique({ where: { id: flagId } });

  if (!flag) {
    return null;
  }

  return {
    id: flag.id,
    key: flag.key,
    enabled: flag.enabled,
    description: flag.description,
  };
}
