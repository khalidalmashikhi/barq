import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, ForbiddenError } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { logger } from "@/lib/logger";
import { uuidv7 } from "@/lib/uuid-v7";
import { isValidIdempotencyKey } from "@/lib/booking/idempotency";
import { isDocumentStorageConfigured, uploadPrivateObject } from "@/lib/storage/storage";
import { registerUploadIntent, releaseUploadIntent, attemptPrivateObjectCleanup } from "@/lib/storage/cleanup/private-object-cleanup";
import { buildAssetDocumentObjectKey, sanitizeOriginalFilename } from "@/lib/vehicles/documents/asset-document-object-key";
import { prepareVehicleDocumentForStorage, type PreparedVehicleDocument } from "@/lib/vehicles/documents/prepare-vehicle-document";
import { safeErrorCategory } from "@/lib/vehicles/documents/safe-error-category";
import type { AssetDocumentErrorCode } from "@/lib/vehicles/documents/asset-document-errors";
import { REGISTRATION_FRONT_TYPE, REGISTRATION_BACK_TYPE } from "@/lib/vehicles/registration-extraction/registration-document-set";
import {
  claimOnboardingRequest,
  releaseOnboardingLease,
  completeOnboardingRequest,
  readOnboardingOutcome,
  OnboardingLeaseLostError,
  type OnboardingClaim,
  type ClaimOptions,
} from "./onboarding-request";
import type { OnboardingRequestErrorCode } from "./onboarding-request-errors";

// Phase 3C Slice 3B — START a document-first vehicle onboarding: the registration document SET is
// uploaded and a blank non-public shell (Asset REGISTERED / verification DRAFT + an all-NULL
// Vehicle) and its registration AssetDocument row(s) come into existence together.
//
// THE SET (registration-extraction/registration-document-set.ts). A registration is supplied as
// exactly ONE of: a PDF of one or two pages; one photo (the front); two ordered photos (front, then
// back). The front/primary file is always `VEHICLE_REGISTRATION`; the optional back photo is
// `VEHICLE_REGISTRATION_BACK`. A PDF never travels with a photo and a back side is never a PDF —
// the set shape is checked here BEFORE anything is stored (INVALID_DOCUMENT_SET). Both rows are
// created in the SAME transaction as the shell, so a PARTIAL two-file set can never exist: either
// the complete ordered set is committed, or nothing is (and every stored object is cleaned up).
//
// SERVER-SIDE, DURABLE IDEMPOTENCY. The request carries an opaque random key issued with the upload
// form. It is bound to the authenticated provider and recorded in VehicleOnboardingRequest — a row
// that is claimed BEFORE any work and that OUTLIVES the setup it produces (see onboarding-request.ts):
//
//   1. claim the request (exactly one attempt owns a PENDING request at a time);
//   2. validate + normalize every file of the set (each one independently; the set shape too);
//   3. record one upload intent per object, then store each private object;
//   4. ONE transaction: create the shell + every document row, release the intents, mark the
//      request COMPLETED (guarded on this attempt's lease) and write the audit;
//
//   • a replay of a COMPLETED request returns THAT setup and touches nothing — the replayed files
//     are never processed or stored, so a key cannot replace a document, add a side, overwrite a
//     confirmed vehicle or create a second shell;
//   • a replay of a CANCELLED request is answered ONBOARDING_CANCELLED — cancelling a setup leaves
//     the request as a tombstone, so its key can never create or resurrect anything;
//   • a second request while the first is still working WAITS for it and gets the same result
//     (no second upload); if it does not finish in time the answer is ONBOARDING_IN_PROGRESS;
//   • a handled failure releases the request, so the same key can be retried (e.g. other files);
//   • an attempt that lost its lease, or whose request was cancelled meanwhile, commits nothing —
//     its already-stored objects are removed through the durable upload intents.
//
// The success audit is written inside the committing transaction, so it exists exactly once.
// Authority is the general vehicle rule only (an APPROVED provider) — never the rental workspace or
// a vertical. Neither the key, the storage keys nor the original filenames are ever logged.

export type OnboardingFile = {
  originalFilename: string;
  declaredMimeType: string;
  bytes: ArrayBuffer;
};

export type StartOnboardingInput = OnboardingFile & {
  /** Opaque idempotency key issued with the upload form (never trusted beyond its format). */
  requestKey: unknown;
  /** OPTIONAL back side of a photographed registration (photos only — never with a PDF). */
  back?: OnboardingFile | null;
};

export type StartOnboardingErrorCode = AssetDocumentErrorCode | OnboardingRequestErrorCode;

export type StartOnboardingResult =
  | { ok: true; vehicleId: string; replayed: boolean }
  | { ok: false; error: StartOnboardingErrorCode };

/** The answer for a request this attempt does not (or no longer) own. */
function answerFor(claim: Exclude<OnboardingClaim, { kind: "OWNER" }>): StartOnboardingResult {
  if (claim.kind === "COMPLETED") return { ok: true, vehicleId: claim.vehicleId, replayed: true };
  return { ok: false, error: claim.kind === "CANCELLED" ? "ONBOARDING_CANCELLED" : "ONBOARDING_IN_PROGRESS" };
}

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
function looksLikePdf(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes, 0, Math.min(5, bytes.byteLength));
  return head.length === 5 && PDF_SIGNATURE.every((b, i) => head[i] === b);
}

type PreparedPage = { type: typeof REGISTRATION_FRONT_TYPE | typeof REGISTRATION_BACK_TYPE; file: OnboardingFile; prepared: Extract<PreparedVehicleDocument, { ok: true }> };

export async function startVehicleOnboarding(input: StartOnboardingInput, options: { claim?: ClaimOptions } = {}): Promise<StartOnboardingResult> {
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

  // 1. CLAIM — the durable request decides before any file work or storage write happens.
  let claim: OnboardingClaim;
  try {
    claim = await claimOnboardingRequest(provider.id, requestKey, options.claim);
  } catch (error) {
    logger.error("vehicleOnboarding.claim_failed", { providerId: provider.id, error: safeErrorCategory(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
  if (claim.kind !== "OWNER") return answerFor(claim);
  const { requestId, leaseToken } = claim;

  // From here this attempt OWNS the PENDING request. Any handled failure gives it back so the same
  // key stays retryable; if even that fails, the lease simply expires.
  const giveBack = async (error: StartOnboardingErrorCode): Promise<StartOnboardingResult> => {
    await releaseOnboardingLease(requestId, leaseToken).catch(() => {});
    return { ok: false, error };
  };

  // Every object this attempt stores has a durable intent; on ANY failure after a write, each one
  // is removed now or by the cleanup worker.
  const intentTaskIds: string[] = [];
  const cleanupStored = async () => {
    for (const id of intentTaskIds) await attemptPrivateObjectCleanup(id).catch(() => {});
  };

  try {
    // 2. Validate + normalize EVERY file of the set BEFORE anything is stored (oversized / renamed /
    //    corrupt / HEIC / encrypted files stop here; an image is re-encoded with its metadata
    //    removed). The front is prepared first; a problem with either file stops the whole set.
    const front = await prepareVehicleDocumentForStorage({ documentType: REGISTRATION_FRONT_TYPE, declaredMimeType: input.declaredMimeType, bytes: input.bytes });
    if (!front.ok) return await giveBack(front.error);
    const pages: PreparedPage[] = [{ type: REGISTRATION_FRONT_TYPE, file: input, prepared: front }];

    if (input.back) {
      // Set shape, decided server-side from what was PROVEN about the files (never the declared
      // types): a PDF is a complete document and never gets a back side; a back side is a photo.
      if (front.mimeType === "application/pdf" || looksLikePdf(input.back.bytes)) return await giveBack("INVALID_DOCUMENT_SET");
      const back = await prepareVehicleDocumentForStorage({ documentType: REGISTRATION_BACK_TYPE, declaredMimeType: input.back.declaredMimeType, bytes: input.back.bytes });
      if (!back.ok) return await giveBack(back.error);
      pages.push({ type: REGISTRATION_BACK_TYPE, file: input.back, prepared: back });
    }

    if (!isDocumentStorageConfigured()) return await giveBack("STORAGE_NOT_CONFIGURED");

    // The asset id is minted up front (UUID v7) because the private storage keys are derived from
    // it and the objects must be written before the transaction that creates the asset.
    const assetId = uuidv7();
    const stored: { page: PreparedPage; objectKey: string }[] = [];

    for (const page of pages) {
      const objectKey = buildAssetDocumentObjectKey({ assetId, type: page.type, ext: page.prepared.ext, unique: randomUUID() });

      // 3. INTENT-FIRST: record the server-generated key durably, then write the object. A failure
      //    on the SECOND object also removes the first — a half-stored set is never left behind.
      try {
        intentTaskIds.push(await registerUploadIntent(objectKey));
      } catch (error) {
        await cleanupStored();
        logger.error("vehicleOnboarding.intent_failed", { providerId: provider.id, error: safeErrorCategory(error) });
        return await giveBack("UNKNOWN_ERROR");
      }

      try {
        await uploadPrivateObject({ objectKey, body: page.prepared.bytes, contentType: page.prepared.mimeType });
      } catch (error) {
        await cleanupStored();
        logger.error("vehicleOnboarding.storage_failed", { providerId: provider.id, error: safeErrorCategory(error) });
        return await giveBack("UPLOAD_FAILED");
      }
      stored.push({ page, objectKey });
    }

    // 4. ONE transaction: shell + every document row + intent releases + request completion + audit.
    //    The complete ordered set appears atomically; a partial set is impossible.
    await prisma.$transaction(async (tx) => {
      await tx.asset.create({ data: { id: assetId, providerId: provider.id, assetType: "VEHICLE", status: "REGISTERED" } });
      // All business fields NULL — no placeholders; values arrive only at the confirmed finalize.
      await tx.vehicle.create({ data: { assetId } });
      for (const { page, objectKey } of stored) {
        // The object is now legitimately referenced → release its upload intent in this transaction.
        if (!(await releaseUploadIntent(tx, objectKey))) throw new Error("upload intent no longer releasable");
        await tx.assetDocument.create({
          data: {
            assetId,
            type: page.type,
            objectKey,
            originalFilename: sanitizeOriginalFilename(page.file.originalFilename),
            mimeType: page.prepared.mimeType,
            sizeBytes: page.prepared.bytes.byteLength,
            status: "PENDING",
          },
        });
      }
      // Guarded: only the attempt still holding the PENDING request may link a setup to it. If the
      // request was cancelled or taken over meanwhile this throws and the whole graph rolls back.
      await completeOnboardingRequest(tx, { requestId, leaseToken, assetId });
      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: provider.id,
          action: "vehicle.onboarding_draft_created",
          entityType: "Vehicle",
          entityId: assetId,
          // Never the request key, object keys, filenames or contents — shape and counts only.
          newValue: {
            status: "REGISTERED",
            verificationStatus: "DRAFT",
            documentType: REGISTRATION_FRONT_TYPE,
            documentNormalized: front.normalized,
            pageCount: stored.length,
            documentSetKind: front.mimeType === "application/pdf" ? "PDF" : stored.length === 2 ? "IMAGES" : "IMAGE",
          },
        },
        tx,
      );
    });
    return { ok: true, vehicleId: assetId, replayed: false };
  } catch (error) {
    // Nothing committed. Every object that was stored still has its upload intent, so it is
    // deleted now or — if that fails, or the database is unavailable — by the cleanup worker.
    await cleanupStored();

    if (error instanceof OnboardingLeaseLostError) {
      // The request moved on without this attempt (cancelled, or completed by a takeover): answer
      // with ITS outcome — never a raw database error, and never by creating anything.
      const outcome = await readOnboardingOutcome(requestId).catch((): OnboardingClaim => ({ kind: "IN_PROGRESS" }));
      return answerFor(outcome.kind === "OWNER" ? { kind: "IN_PROGRESS" } : outcome);
    }
    logger.error("vehicleOnboarding.start_failed", { providerId: provider.id, error: safeErrorCategory(error) });
    return await giveBack("UNKNOWN_ERROR");
  }
}
