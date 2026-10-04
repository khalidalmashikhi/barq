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
import { prepareVehicleDocumentForStorage } from "@/lib/vehicles/documents/prepare-vehicle-document";
import { safeErrorCategory } from "@/lib/vehicles/documents/safe-error-category";
import type { AssetDocumentErrorCode } from "@/lib/vehicles/documents/asset-document-errors";
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

// Phase 3C Slice 3B — START a document-first vehicle onboarding: the registration document is
// uploaded and a blank non-public shell (Asset REGISTERED / verification DRAFT + an all-NULL
// Vehicle) and its registration AssetDocument come into existence together.
//
// SERVER-SIDE, DURABLE IDEMPOTENCY. The request carries an opaque random key issued with the upload
// form. It is bound to the authenticated provider and recorded in VehicleOnboardingRequest — a row
// that is claimed BEFORE any work and that OUTLIVES the setup it produces (see onboarding-request.ts):
//
//   1. claim the request (exactly one attempt owns a PENDING request at a time);
//   2. validate + normalize the document;
//   3. record the upload intent, then store the private object;
//   4. ONE transaction: create the shell + document, release the intent, mark the request
//      COMPLETED (guarded on this attempt's lease) and write the audit;
//
//   • a replay of a COMPLETED request returns THAT setup and touches nothing — the replayed file is
//     never processed or stored, so a key cannot replace a document, overwrite a confirmed vehicle
//     or create a second shell;
//   • a replay of a CANCELLED request is answered ONBOARDING_CANCELLED — cancelling a setup leaves
//     the request as a tombstone, so its key can never create or resurrect anything;
//   • a second request while the first is still working WAITS for it and gets the same result
//     (no second upload); if it does not finish in time the answer is ONBOARDING_IN_PROGRESS;
//   • a handled failure releases the request, so the same key can be retried (e.g. another file);
//   • an attempt that lost its lease, or whose request was cancelled meanwhile, commits nothing —
//     its already-stored object is removed through the durable upload intent;
//   • the key is scoped by provider: the same key from another provider is that provider's own,
//     unrelated request.
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

export type StartOnboardingErrorCode = AssetDocumentErrorCode | OnboardingRequestErrorCode;

export type StartOnboardingResult =
  | { ok: true; vehicleId: string; replayed: boolean }
  | { ok: false; error: StartOnboardingErrorCode };

const DOCUMENT_TYPE = "VEHICLE_REGISTRATION";

/** The answer for a request this attempt does not (or no longer) own. */
function answerFor(claim: Exclude<OnboardingClaim, { kind: "OWNER" }>): StartOnboardingResult {
  if (claim.kind === "COMPLETED") return { ok: true, vehicleId: claim.vehicleId, replayed: true };
  return { ok: false, error: claim.kind === "CANCELLED" ? "ONBOARDING_CANCELLED" : "ONBOARDING_IN_PROGRESS" };
}

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

  let intentTaskId: string | null = null;
  try {
    // 2. Validate + normalize BEFORE anything is stored (oversized/renamed/corrupt/HEIC/encrypted
    //    files stop here; an image is re-encoded with its metadata removed).
    const prepared = await prepareVehicleDocumentForStorage({ documentType: DOCUMENT_TYPE, declaredMimeType: input.declaredMimeType, bytes: input.bytes });
    if (!prepared.ok) return await giveBack(prepared.error);

    if (!isDocumentStorageConfigured()) return await giveBack("STORAGE_NOT_CONFIGURED");

    // The asset id is minted up front (UUID v7) because the private storage key is derived from it
    // and the object must be written before the transaction that creates the asset.
    const assetId = uuidv7();
    const objectKey = buildAssetDocumentObjectKey({ assetId, type: DOCUMENT_TYPE, ext: prepared.ext, unique: randomUUID() });

    // 3. INTENT-FIRST: record the server-generated key durably, then write the object.
    try {
      intentTaskId = await registerUploadIntent(objectKey);
    } catch (error) {
      logger.error("vehicleOnboarding.intent_failed", { providerId: provider.id, error: safeErrorCategory(error) });
      return await giveBack("UNKNOWN_ERROR");
    }

    try {
      await uploadPrivateObject({ objectKey, body: prepared.bytes, contentType: prepared.mimeType });
    } catch (error) {
      await attemptPrivateObjectCleanup(intentTaskId).catch(() => {});
      logger.error("vehicleOnboarding.storage_failed", { providerId: provider.id, error: safeErrorCategory(error) });
      return await giveBack("UPLOAD_FAILED");
    }

    // 4. ONE transaction: shell + document + intent release + request completion + audit.
    await prisma.$transaction(async (tx) => {
      await tx.asset.create({ data: { id: assetId, providerId: provider.id, assetType: "VEHICLE", status: "REGISTERED" } });
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
          // Never the request key, object key, filename or contents.
          newValue: { status: "REGISTERED", verificationStatus: "DRAFT", documentType: DOCUMENT_TYPE, documentNormalized: prepared.normalized },
        },
        tx,
      );
    });
    return { ok: true, vehicleId: assetId, replayed: false };
  } catch (error) {
    // Nothing committed. If an object was stored, its upload intent still exists, so it is deleted
    // now or — if that fails, or the database is unavailable — by the cleanup worker.
    if (intentTaskId) await attemptPrivateObjectCleanup(intentTaskId).catch(() => {});

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
