import "server-only";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { logger } from "@/lib/logger";
import { removeObject } from "@/lib/storage/storage";
import { uploadProviderImage } from "./upload-provider-image";
import type { ProviderMediaErrorCode } from "./provider-media-errors";

// Provider cover image (Media Foundation, Gap C). A single COVER MediaAsset
// per provider — same replace-and-clean-up shape as the logo, but the cover
// has no denormalized column: read paths resolve it from the MediaAsset row
// (see get-provider-media.ts). Parallel to update-provider-logo.ts by
// design; the reusable half is uploadProviderImage() + the storage/model
// foundation.

export type UpdateProviderCoverResult = { ok: true; url: string } | { ok: false; error: ProviderMediaErrorCode };

export async function updateProviderCover(file: File, providerId: string): Promise<UpdateProviderCoverResult> {
  const uploaded = await uploadProviderImage(file, providerId, "COVER");
  if (!uploaded.ok) {
    return uploaded;
  }
  const { objectKey, url, mimeType, sizeBytes } = uploaded.image;

  let staleObjectKeys: string[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      const previous = await tx.mediaAsset.findMany({
        where: { providerId, kind: "COVER" },
        select: { id: true, objectKey: true, url: true },
      });
      staleObjectKeys = previous.map((a) => a.objectKey);

      const created = await tx.mediaAsset.create({
        data: { ownerType: "PROVIDER", kind: "COVER", objectKey, url, mimeType, sizeBytes, providerId },
        select: { id: true },
      });

      if (previous.length > 0) {
        await tx.mediaAsset.deleteMany({ where: { id: { in: previous.map((a) => a.id) } } });
      }

      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: providerId,
          action: "provider.cover_updated",
          entityType: "Provider",
          entityId: providerId,
          previousValue: { coverUrl: previous[0]?.url ?? null },
          newValue: { coverUrl: url, mediaAssetId: created.id },
        },
        tx
      );
    });
  } catch (error) {
    await removeObject(objectKey).catch(() => {});
    logger.error("updateProviderCover.persist_failed", {
      providerId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }

  for (const key of staleObjectKeys) {
    await removeObject(key).catch((error) => {
      logger.error("updateProviderCover.stale_object_cleanup_failed", {
        providerId,
        objectKey: key,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }

  return { ok: true, url };
}
