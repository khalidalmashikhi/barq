import "server-only";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { logger } from "@/lib/logger";
import { removeObject } from "@/lib/storage/storage";
import { MAX_SERVICE_GALLERY_ITEMS } from "@/lib/storage/media-constants";
import { uploadOwnedImage } from "@/lib/media/upload-owned-image";
import { assertServiceOwnership } from "./assert-service-ownership";
import type { ProviderMediaErrorCode } from "@/lib/provider/media/provider-media-errors";

// Add one service gallery image (Media Foundation, Gap C). Multi-image
// GALLERY kind; each add is a new MediaAsset, ordered by createdAt on read.
// Capped at MAX_SERVICE_GALLERY_ITEMS, checked BEFORE upload so a rejected
// add leaves no orphan. Ownership enforced first.

export type AddServiceGalleryImageResult = { ok: true; url: string } | { ok: false; error: ProviderMediaErrorCode };

export async function addServiceGalleryImage(
  file: File,
  serviceId: string,
  providerId: string
): Promise<AddServiceGalleryImageResult> {
  const ownershipError = await assertServiceOwnership(serviceId, providerId);
  if (ownershipError) {
    return { ok: false, error: ownershipError };
  }

  const existingCount = await prisma.mediaAsset.count({ where: { serviceId, kind: "GALLERY" } });
  if (existingCount >= MAX_SERVICE_GALLERY_ITEMS) {
    return { ok: false, error: "LIMIT_REACHED" };
  }

  const uploaded = await uploadOwnedImage(file, "SERVICE", serviceId, "GALLERY");
  if (!uploaded.ok) {
    return uploaded;
  }
  const { objectKey, url, mimeType, sizeBytes } = uploaded.image;

  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.mediaAsset.create({
        data: { ownerType: "SERVICE", kind: "GALLERY", objectKey, url, mimeType, sizeBytes, serviceId },
        select: { id: true },
      });
      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: providerId,
          action: "service.gallery_added",
          entityType: "Service",
          entityId: serviceId,
          newValue: { mediaAssetId: created.id, url },
        },
        tx
      );
    });
  } catch (error) {
    await removeObject(objectKey).catch(() => {});
    logger.error("addServiceGalleryImage.persist_failed", {
      serviceId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }

  return { ok: true, url };
}
