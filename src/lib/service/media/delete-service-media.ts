import "server-only";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { logger } from "@/lib/logger";
import { removeObject } from "@/lib/storage/storage";
import type { ProviderMediaErrorCode } from "@/lib/provider/media/provider-media-errors";

// Delete one service media item — cover or gallery (Media Foundation, Gap C).
// OWNERSHIP ENFORCED SERVER-SIDE via the asset's service.providerId: a
// provider can only delete media on their own service, and only when the
// asset actually belongs to the service in the URL (guards against a crafted
// mediaId from another service). Storage cleanup is best-effort after the DB
// row is gone (the row is authoritative).

export type DeleteServiceMediaResult = { ok: true } | { ok: false; error: ProviderMediaErrorCode };

export async function deleteServiceMedia(
  mediaId: string,
  serviceId: string,
  providerId: string
): Promise<DeleteServiceMediaResult> {
  const asset = await prisma.mediaAsset.findUnique({
    where: { id: mediaId },
    select: { id: true, serviceId: true, kind: true, objectKey: true, service: { select: { providerId: true } } },
  });

  if (!asset || asset.serviceId !== serviceId || !asset.service) {
    return { ok: false, error: "NOT_FOUND" };
  }
  if (asset.service.providerId !== providerId) {
    return { ok: false, error: "FORBIDDEN" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.mediaAsset.delete({ where: { id: asset.id } });
      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: providerId,
          action: "service.media_removed",
          entityType: "Service",
          entityId: serviceId,
          previousValue: { mediaAssetId: asset.id, kind: asset.kind },
        },
        tx
      );
    });
  } catch (error) {
    logger.error("deleteServiceMedia.persist_failed", {
      serviceId,
      mediaId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }

  await removeObject(asset.objectKey).catch((error) => {
    logger.error("deleteServiceMedia.object_cleanup_failed", {
      serviceId,
      objectKey: asset.objectKey,
      message: error instanceof Error ? error.message : String(error),
    });
  });

  return { ok: true };
}
