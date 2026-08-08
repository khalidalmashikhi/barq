import "server-only";
import { logger } from "@/lib/logger";
import { validateImageUpload, type MediaKind } from "@/lib/storage/media-constants";
import { buildMediaObjectKey } from "@/lib/storage/object-key";
import { isStorageConfigured, uploadObject, getPublicObjectUrl } from "@/lib/storage/storage";
import { validationErrorToMediaCode, type ProviderMediaErrorCode } from "./provider-media-errors";

// Shared validate → configured? → upload step for provider media (cover,
// portfolio). The FK/DB transaction differs per surface and stays in each
// orchestration; this is the common, reusable front half (Media Foundation,
// Gap C). The logo slice shipped first with its own inlined copy.

export type UploadedProviderImage = { objectKey: string; url: string; mimeType: string; sizeBytes: number };

export async function uploadProviderImage(
  file: File,
  providerId: string,
  kind: MediaKind
): Promise<{ ok: true; image: UploadedProviderImage } | { ok: false; error: ProviderMediaErrorCode }> {
  const validation = validateImageUpload({ type: file.type, size: file.size });
  if (!validation.ok) {
    return { ok: false, error: validationErrorToMediaCode(validation.error) };
  }
  if (!isStorageConfigured()) {
    return { ok: false, error: "STORAGE_NOT_CONFIGURED" };
  }

  const objectKey = buildMediaObjectKey({
    ownerType: "PROVIDER",
    ownerId: providerId,
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
    logger.error("uploadProviderImage.upload_failed", {
      providerId,
      kind,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UPLOAD_FAILED" };
  }
}
