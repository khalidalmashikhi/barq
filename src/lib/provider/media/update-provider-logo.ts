import "server-only";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { logger } from "@/lib/logger";
import { validateImageUpload } from "@/lib/storage/media-constants";
import { buildMediaObjectKey } from "@/lib/storage/object-key";
import {
  isStorageConfigured,
  uploadObject,
  getPublicObjectUrl,
  removeObject,
} from "@/lib/storage/storage";
import type { ProviderLogoErrorCode } from "./provider-logo-errors";

// Provider logo upload orchestration (Media Foundation, Gap C).
//
// This is the testable core the route handler is a thin wrapper around
// (parse + auth + redirect). Everything network/DB here is injectable via
// module mocks; the pure validation/key rules live in @/lib/storage/*.
//
// FLOW: validate → (storage configured?) → upload bytes to Supabase → in ONE
// transaction: create the new MediaAsset, repoint providers.logoUrl at its
// public URL (so every existing read path keeps working with zero changes),
// delete the previous LOGO MediaAsset rows, and audit the change atomically
// (BR-019). AFTER commit, best-effort-delete the old storage objects — the
// DB row is already the source of truth, so a failed object cleanup only
// leaves an orphaned blob, never a broken record.

export type UpdateProviderLogoResult =
  | { ok: true; url: string }
  | { ok: false; error: ProviderLogoErrorCode };

const VALIDATION_ERROR_TO_CODE: Record<string, ProviderLogoErrorCode> = {
  UNSUPPORTED_TYPE: "UNSUPPORTED_TYPE",
  TOO_LARGE: "TOO_LARGE",
  EMPTY_FILE: "EMPTY_FILE",
};

export async function updateProviderLogo(file: File, providerId: string): Promise<UpdateProviderLogoResult> {
  const validation = validateImageUpload({ type: file.type, size: file.size });
  if (!validation.ok) {
    return { ok: false, error: VALIDATION_ERROR_TO_CODE[validation.error] ?? "INVALID_INPUT" };
  }

  // Decline politely when the bucket/keys aren't provisioned — never crash.
  if (!isStorageConfigured()) {
    return { ok: false, error: "STORAGE_NOT_CONFIGURED" };
  }

  const objectKey = buildMediaObjectKey({
    ownerType: "PROVIDER",
    ownerId: providerId,
    kind: "LOGO",
    unique: crypto.randomUUID(),
    ext: validation.ext,
  });

  let publicUrl: string;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await uploadObject({ objectKey, body: bytes, contentType: validation.mimeType });
    publicUrl = getPublicObjectUrl(objectKey);
  } catch (error) {
    logger.error("updateProviderLogo.upload_failed", {
      providerId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UPLOAD_FAILED" };
  }

  let staleObjectKeys: string[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      const provider = await tx.provider.findUnique({ where: { id: providerId }, select: { logoUrl: true } });
      const previousLogoUrl = provider?.logoUrl ?? null;

      const previousLogoAssets = await tx.mediaAsset.findMany({
        where: { providerId, kind: "LOGO" },
        select: { id: true, objectKey: true },
      });
      staleObjectKeys = previousLogoAssets.map((asset) => asset.objectKey);

      const created = await tx.mediaAsset.create({
        data: {
          ownerType: "PROVIDER",
          kind: "LOGO",
          objectKey,
          url: publicUrl,
          mimeType: validation.mimeType,
          sizeBytes: file.size,
          providerId,
        },
        select: { id: true },
      });

      await tx.provider.update({ where: { id: providerId }, data: { logoUrl: publicUrl } });

      if (previousLogoAssets.length > 0) {
        await tx.mediaAsset.deleteMany({ where: { id: { in: previousLogoAssets.map((a) => a.id) } } });
      }

      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: providerId,
          action: "provider.logo_updated",
          entityType: "Provider",
          entityId: providerId,
          previousValue: { logoUrl: previousLogoUrl },
          newValue: { logoUrl: publicUrl, mediaAssetId: created.id },
        },
        tx
      );
    });
  } catch (error) {
    // DB write failed after the object was uploaded — clean up the orphan we
    // just created so a retry doesn't accumulate dead objects.
    await removeObject(objectKey).catch(() => {});
    logger.error("updateProviderLogo.persist_failed", {
      providerId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }

  // Best-effort cleanup of the replaced object(s). The new row is already
  // committed and authoritative, so failures here are logged, not surfaced.
  for (const key of staleObjectKeys) {
    await removeObject(key).catch((error) => {
      logger.error("updateProviderLogo.stale_object_cleanup_failed", {
        providerId,
        objectKey: key,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }

  return { ok: true, url: publicUrl };
}
