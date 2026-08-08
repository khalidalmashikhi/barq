import "server-only";
import { logger } from "@/lib/logger";
import { validateImageUpload, type MediaKind, type MediaOwnerType } from "@/lib/storage/media-constants";
import { buildMediaObjectKey } from "@/lib/storage/object-key";
import { isStorageConfigured, uploadObject, getPublicObjectUrl } from "@/lib/storage/storage";
import { validationErrorToMediaCode, type ProviderMediaErrorCode } from "@/lib/provider/media/provider-media-errors";

// The single owner-agnostic "validate → configured? → upload" step for ALL
// user media (provider logo/cover/portfolio AND service cover/gallery) —
// Media Foundation, Gap C. The DB transaction (which FK to write, ownership,
// audit) differs per owner and stays in each orchestration; this is the one
// shared front half, sitting directly on the storage core. Provider's
// uploadProviderImage() now delegates here — one uploader, not two systems.
//
// ProviderMediaErrorCode is a generic media error union (the name is
// historical — the logo slice shipped first); reused verbatim for services.

export type UploadedImage = { objectKey: string; url: string; mimeType: string; sizeBytes: number };

export async function uploadOwnedImage(
  file: File,
  ownerType: MediaOwnerType,
  ownerId: string,
  kind: MediaKind
): Promise<{ ok: true; image: UploadedImage } | { ok: false; error: ProviderMediaErrorCode }> {
  const validation = validateImageUpload({ type: file.type, size: file.size });
  if (!validation.ok) {
    return { ok: false, error: validationErrorToMediaCode(validation.error) };
  }
  if (!isStorageConfigured()) {
    return { ok: false, error: "STORAGE_NOT_CONFIGURED" };
  }

  const objectKey = buildMediaObjectKey({
    ownerType,
    ownerId,
    kind,
    unique: crypto.randomUUID(),
    ext: validation.ext,
  });

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await uploadObject({ objectKey, body: bytes, contentType: validation.mimeType });
    return {
      ok: true,
      image: { objectKey, url: getPublicObjectUrl(objectKey), mimeType: validation.mimeType, sizeBytes: file.size },
    };
  } catch (error) {
    logger.error("uploadOwnedImage.upload_failed", {
      ownerType,
      ownerId,
      kind,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UPLOAD_FAILED" };
  }
}
