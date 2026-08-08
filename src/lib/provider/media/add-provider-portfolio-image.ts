import "server-only";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { logger } from "@/lib/logger";
import { removeObject } from "@/lib/storage/storage";
import { MAX_PROVIDER_PORTFOLIO_ITEMS } from "@/lib/storage/media-constants";
import { uploadProviderImage } from "./upload-provider-image";
import type { ProviderMediaErrorCode } from "./provider-media-errors";

// Add one portfolio/gallery image (Media Foundation, Gap C). PORTFOLIO is a
// multi-image kind (unlike the singleton LOGO/COVER): each add is a new
// MediaAsset. Ordered by createdAt on read; an explicit drag-reorder is a
// documented follow-up (needs a sortOrder column). Capped at
// MAX_PROVIDER_PORTFOLIO_ITEMS to keep gallery queries + the public grid
// bounded — the cap is checked BEFORE upload so a rejected add leaves no
// orphan object.

export type AddProviderPortfolioImageResult = { ok: true; url: string } | { ok: false; error: ProviderMediaErrorCode };

export async function addProviderPortfolioImage(
  file: File,
  providerId: string
): Promise<AddProviderPortfolioImageResult> {
  const existingCount = await prisma.mediaAsset.count({ where: { providerId, kind: "PORTFOLIO" } });
  if (existingCount >= MAX_PROVIDER_PORTFOLIO_ITEMS) {
    return { ok: false, error: "LIMIT_REACHED" };
  }

  const uploaded = await uploadProviderImage(file, providerId, "PORTFOLIO");
  if (!uploaded.ok) {
    return uploaded;
  }
  const { objectKey, url, mimeType, sizeBytes } = uploaded.image;

  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.mediaAsset.create({
        data: { ownerType: "PROVIDER", kind: "PORTFOLIO", objectKey, url, mimeType, sizeBytes, providerId },
        select: { id: true },
      });
      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: providerId,
          action: "provider.portfolio_added",
          entityType: "Provider",
          entityId: providerId,
          newValue: { mediaAssetId: created.id, url },
        },
        tx
      );
    });
  } catch (error) {
    await removeObject(objectKey).catch(() => {});
    logger.error("addProviderPortfolioImage.persist_failed", {
      providerId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }

  return { ok: true, url };
}
