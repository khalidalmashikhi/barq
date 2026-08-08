import "server-only";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { logger } from "@/lib/logger";
import { removeObject } from "@/lib/storage/storage";
import type { ProviderMediaErrorCode } from "./provider-media-errors";

// Delete one provider media item — logo, cover, or a portfolio image
// (Media Foundation, Gap C). OWNERSHIP IS ENFORCED SERVER-SIDE: the asset's
// providerId must match the authenticated provider, else FORBIDDEN — a
// provider can never mutate another provider's media by guessing an id.
// Deleting a LOGO also clears the denormalized providers.logoUrl so the
// public profile falls back to the initial-letter avatar. Storage object
// removal is best-effort AFTER the DB row is gone (the row is authoritative).

export type DeleteProviderMediaResult = { ok: true } | { ok: false; error: ProviderMediaErrorCode };

export async function deleteProviderMedia(mediaId: string, providerId: string): Promise<DeleteProviderMediaResult> {
  const asset = await prisma.mediaAsset.findUnique({
    where: { id: mediaId },
    select: { id: true, providerId: true, kind: true, objectKey: true, url: true },
  });

  if (!asset || asset.providerId === null) {
    return { ok: false, error: "NOT_FOUND" };
  }
  if (asset.providerId !== providerId) {
    return { ok: false, error: "FORBIDDEN" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (asset.kind === "LOGO") {
        await tx.provider.update({ where: { id: providerId }, data: { logoUrl: null } });
      }
      await tx.mediaAsset.delete({ where: { id: asset.id } });
      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: providerId,
          action: "provider.media_removed",
          entityType: "Provider",
          entityId: providerId,
          previousValue: { mediaAssetId: asset.id, kind: asset.kind, url: asset.url },
        },
        tx
      );
    });
  } catch (error) {
    logger.error("deleteProviderMedia.persist_failed", {
      providerId,
      mediaId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }

  await removeObject(asset.objectKey).catch((error) => {
    logger.error("deleteProviderMedia.object_cleanup_failed", {
      providerId,
      objectKey: asset.objectKey,
      message: error instanceof Error ? error.message : String(error),
    });
  });

  return { ok: true };
}
