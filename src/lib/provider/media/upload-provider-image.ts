import "server-only";
import type { MediaKind } from "@/lib/storage/media-constants";
import { uploadOwnedImage, type UploadedImage } from "@/lib/media/upload-owned-image";
import type { ProviderMediaErrorCode } from "./provider-media-errors";

// Provider-scoped thin wrapper over the shared owner-agnostic uploader
// (Media Foundation, Gap C). Kept as a named helper so the provider cover/
// portfolio orchestrations read clearly; all logic lives in
// @/lib/media/upload-owned-image (one uploader, one storage system).

export type UploadedProviderImage = UploadedImage;

export function uploadProviderImage(
  file: File,
  providerId: string,
  kind: MediaKind
): Promise<{ ok: true; image: UploadedProviderImage } | { ok: false; error: ProviderMediaErrorCode }> {
  return uploadOwnedImage(file, "PROVIDER", providerId, kind);
}
