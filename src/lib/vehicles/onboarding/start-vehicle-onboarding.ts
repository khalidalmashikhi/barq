import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, ForbiddenError } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { logger } from "@/lib/logger";
import { uuidv7 } from "@/lib/uuid-v7";
import { isValidIdempotencyKey } from "@/lib/booking/idempotency";
import { isDocumentStorageConfigured, uploadPrivateObject } from "@/lib/storage/storage";
import { registerUploadIntent, releaseUploadIntent, attemptPrivateObjectCleanup } from "@/lib/storage/cleanup/private-object-cleanup";
import { buildAssetDocumentObjectKey, sanitizeOriginalFilename } from "@/lib/vehicles/documents/asset-document-object-key";
import { prepareDocumentForStorage } from "@/lib/vehicles/documents/prepare-document";
import { safeErrorCategory } from "@/lib/vehicles/documents/safe-error-category";
import type { AssetDocumentErrorCode } from "@/lib/vehicles/documents/asset-document-errors";

// Phase 3C Slice 3B — START a document-first vehicle onboarding: the registration document is
// uploaded and, in ONE transaction, a blank non-public shell (Asset REGISTERED / verification DRAFT +
// an all-NULL Vehicle) and its registration AssetDocument come into existence together.
//
// SERVER-SIDE IDEMPOTENCY. The request carries an opaque random key issued with the upload form.
// It is bound to the authenticated provider and stored on the asset; `(providerId,
// onboardingRequestKey)` is UNIQUE, so the database — not the button, not React state — decides:
//
//   • a replay of a key whose setup already exists returns THAT setup and touches nothing: the
//     file in the replayed request is never stored, so a key cannot replace a document, overwrite a
//     confirmed vehicle, or create a second shell;
//   • two concurrent requests with the same key both prepare and upload, but only one transaction
//     commits (the other fails the unique constraint). The loser's object is still covered by its
//     upload INTENT and is durably cleaned up; it is then answered with the winner's setup;
//   • the key is scoped by provider, so the same key from another provider is simply that
//     provider's own, separate setup — it can never reach or reveal the first one;
//   • two different keys are two different vehicles.
//
// The success audit is written inside the committing transaction, so it exists exactly once.
// Authority is the general vehicle rule only (an APPROVED provider) — never the rental workspace or
// a vertical. Neither the key, the storage key nor the original filename is ever logged.

export type StartOnboardingInput = {
  /** Opaque idempotency key issued with the upload form (never trusted beyond its format). */
  requestKey: unknown;
  originalFilename: string;
  declaredMimeType: string;
  bytes: ArrayBuffer;
};

export type StartOnboardingResult =
  | { ok: true; vehicleId: string; replayed: boolean }
  | { ok: false; error: AssetDocumentErrorCode };

const DOCUMENT_TYPE = "VEHICLE_REGISTRATION";

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function findExistingSetup(providerId: string, requestKey: string): Promise<string | null> {
  const existing = await prisma.asset.findFirst({
    where: { providerId, onboardingRequestKey: requestKey, assetType: "VEHICLE" },
    select: { id: true },
  });
  return existing?.id ?? null;
}

export async function startVehicleOnboarding(input: StartOnboardingInput): Promise<StartOnboardingResult> {
  // The key is REQUIRED and must be well-formed (same rule as every other BARQ idempotency key).
  if (!isValidIdempotencyKey(input.requestKey)) return { ok: false, error: "INVALID_INPUT" };
  const requestKey = input.requestKey;

  let provider;
  try {
    ({ provider } = await requireApprovedProvider());
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: error.code === "PROVIDER_NOT_APPROVED" ? "PROVIDER_NOT_APPROVED" : "NO_PROVIDER_PROFILE" };
    }
    throw error; // UnauthenticatedError → route adapter maps to sign-in
  }

  // REPLAY (fast path): this provider already has a setup for this key → return it, do nothing else.
  const replay = await findExistingSetup(provider.id, requestKey);
  if (replay) return { ok: true, vehicleId: replay, replayed: true };

  // Validate + normalize the document BEFORE anything is stored (oversized/renamed/corrupt/HEIC/
  // encrypted files stop here; an image is re-encoded with its metadata removed).
  const prepared = await prepareDocumentForStorage({ declaredMimeType: input.declaredMimeType, bytes: input.bytes, pdfPolicy: "REGISTRATION" });
  if (!prepared.ok) return { ok: false, error: prepared.error };

  if (!isDocumentStorageConfigured()) return { ok: false, error: "STORAGE_NOT_CONFIGURED" };

  // The asset id is minted up front (UUID v7) because the private storage key is derived from it
  // and the object must be written before the transaction that creates the asset.
  const assetId = uuidv7();
  const objectKey = buildAssetDocumentObjectKey({ assetId, type: DOCUMENT_TYPE, ext: prepared.ext, unique: randomUUID() });

  // INTENT-FIRST: record the server-generated key durably, then write the object.
  let intentTaskId: string;
  try {
    intentTaskId = await registerUploadIntent(objectKey);
  } catch (error) {
    logger.error("vehicleOnboarding.intent_failed", { providerId: provider.id, error: safeErrorCategory(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }

  try {
    await uploadPrivateObject({ objectKey, body: prepared.bytes, contentType: prepared.mimeType });
  } catch (error) {
    await attemptPrivateObjectCleanup(intentTaskId).catch(() => {});
    logger.error("vehicleOnboarding.storage_failed", { providerId: provider.id, error: safeErrorCategory(error) });
    return { ok: false, error: "UPLOAD_FAILED" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // The unique (providerId, onboardingRequestKey) index arbitrates here: a concurrent request
      // with the same key that committed first makes THIS insert fail, rolling everything back.
      await tx.asset.create({
        data: { id: assetId, providerId: provider.id, assetType: "VEHICLE", status: "REGISTERED", onboardingRequestKey: requestKey },
      });
      // All business fields NULL — no placeholders; values arrive only at the confirmed finalize.
      await tx.vehicle.create({ data: { assetId } });
      // The object is now legitimately referenced → release its upload intent in this transaction.
      if (!(await releaseUploadIntent(tx, objectKey))) throw new Error("upload intent no longer releasable");
      await tx.assetDocument.create({
        data: {
          assetId,
          type: DOCUMENT_TYPE,
          objectKey,
          originalFilename: sanitizeOriginalFilename(input.originalFilename),
          mimeType: prepared.mimeType,
          sizeBytes: prepared.bytes.byteLength,
          status: "PENDING",
        },
      });
      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: provider.id,
          action: "vehicle.onboarding_draft_created",
          entityType: "Vehicle",
          entityId: assetId,
          // Never the request key, object key, filename or contents.
          newValue: { status: "REGISTERED", verificationStatus: "DRAFT", documentType: DOCUMENT_TYPE, documentNormalized: prepared.normalized },
        },
        tx,
      );
    });
    return { ok: true, vehicleId: assetId, replayed: false };
  } catch (error) {
    // Nothing committed: the upload intent still exists, so the object is deleted now or — if that
    // fails, or the database is unavailable — by the cleanup worker. It can never be stranded.
    await attemptPrivateObjectCleanup(intentTaskId).catch(() => {});

    if (isUniqueViolation(error)) {
      // Lost the same-key race: answer with the setup the winner created (never a raw DB error).
      const winner = await findExistingSetup(provider.id, requestKey).catch(() => null);
      if (winner) return { ok: true, vehicleId: winner, replayed: true };
    }
    logger.error("vehicleOnboarding.start_failed", { providerId: provider.id, error: safeErrorCategory(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
