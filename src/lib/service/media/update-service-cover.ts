import "server-only";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { logger } from "@/lib/logger";
import { removeObject } from "@/lib/storage/storage";
import { uploadOwnedImage } from "@/lib/media/upload-owned-image";
import { assertServiceOwnership } from "./assert-service-ownership";
import type { ProviderMediaErrorCode } from "@/lib/provider/media/provider-media-errors";

// Service cover image (Media Foundation, Gap C). Single COVER MediaAsset per
// service, replace-and-clean-up — the same shape as the provider cover, now
// FK-backed by serviceId (the FK shipped in slice 1, so no migration).
// Ownership is enforced BEFORE any upload.

export type UpdateServiceCoverResult = { ok: true; url: string } | { ok: false; error: ProviderMediaErrorCode };

export async function updateServiceCover(
  file: File,
  serviceId: string,
  providerId: string
): Promise<UpdateServiceCoverResult> {
  const ownershipError = await assertServiceOwnership(serviceId, providerId);
  if (ownershipError) {
    return { ok: false, error: ownershipError };
  }

  const uploaded = await uploadOwnedImage(file, "SERVICE", serviceId, "COVER");
  if (!uploaded.ok) {
    return uploaded;
  }
  const { objectKey, url, mimeType, sizeBytes } = uploaded.image;

  let staleObjectKeys: string[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      const previous = await tx.mediaAsset.findMany({
        where: { serviceId, kind: "COVER" },
        select: { id: true, objectKey: true, url: true },
      });
      staleObjectKeys = previous.map((a) => a.objectKey);

      const created = await tx.mediaAsset.create({
        data: { ownerType: "SERVICE", kind: "COVER", objectKey, url, mimeType, sizeBytes, serviceId },
        select: { id: true },
      });

      if (previous.length > 0) {
        await tx.mediaAsset.deleteMany({ where: { id: { in: previous.map((a) => a.id) } } });
      }

      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: providerId,
          action: "service.cover_updated",
          entityType: "Service",
          entityId: serviceId,
          previousValue: { coverUrl: previous[0]?.url ?? null },
          newValue: { coverUrl: url, mediaAssetId: created.id },
        },
        tx
      );
    });
  } catch (error) {
    await removeObject(objectKey).catch(() => {});
    logger.error("updateServiceCover.persist_failed", {
      serviceId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }

  for (const key of staleObjectKeys) {
    await removeObject(key).catch((error) => {
      logger.error("updateServiceCover.stale_object_cleanup_failed", {
        serviceId,
        objectKey: key,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }

  return { ok: true, url };
}
