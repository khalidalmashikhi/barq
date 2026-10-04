import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { removePrivateObject, StorageNotConfiguredError } from "@/lib/storage/storage";

// Phase 3C Slice 3B (durable-cleanup correction) — the durable, retryable private-object deletion
// mechanism. Best-effort post-commit deletion + a log line does NOT guarantee eventual removal, and
// a cancelled/replaced registration document may hold owner / plate / chassis / civil-ID data. This
// persists a failed deletion as a DB row and a CRON_SECRET-protected worker retries it to completion.
//
// Mirrors the established booking-email outbox EXACTLY: a guarded single-claim update (status +
// attemptCount CAS) so two workers never process one row; a bounded batch; deterministic backoff; the
// slow storage call happens OUTSIDE any DB transaction; stale-PROCESSING rows left by a crashed
// worker are reclaimable. It is NOT a second general queue — it is the smallest durable outbox for
// one concern (private-object deletion), following the same pattern. No public API exposes it.

export type CleanupPurpose =
  | "VEHICLE_REGISTRATION_ONBOARDING" // cancelled onboarding shell's registration document
  | "VEHICLE_DOCUMENT_REPLACEMENT" // superseded object after a successful document replacement
  | "VEHICLE_DOCUMENT_DELETED" // object of a provider-deleted document
  | "VEHICLE_DOCUMENT_UPLOAD_INTENT"; // an upload in flight — released when its DB row persists

export const MAX_CLEANUP_ATTEMPTS = 8;
// An upload INTENT is not due until this grace elapses — far longer than any real upload request, so
// the worker can never delete an object whose upload is still legitimately in flight.
export const UPLOAD_INTENT_GRACE_MS = 30 * 60 * 1000;
const BASE_BACKOFF_MS = 60_000; // 1 min, exponential, capped
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000; // 6 h
// A PROCESSING row untouched longer than this is assumed abandoned by a crashed worker.
const STALE_CLAIM_MS = 10 * 60 * 1000;
const DEFAULT_BATCH = 25;

function backoffMs(attemptNo: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attemptNo - 1));
}

type StorageErrorClass = { code: string; absent: boolean; retryable: boolean };

// Reduce a thrown storage error to a SAFE category — never the raw message (it can contain the
// object key / a signed URL / provider internals). "absent" (already gone) counts as success;
// clearly-malformed targets fail closed (visible to ops); everything else is treated as transient.
function classifyStorageError(error: unknown): StorageErrorClass {
  if (error instanceof StorageNotConfiguredError) return { code: "STORAGE_NOT_CONFIGURED", absent: false, retryable: true };
  const raw = error instanceof Error ? error.message : String(error);
  const m = raw.toLowerCase();
  if (/not ?found|no such key|does not exist|no such file|keynotfound/.test(m)) return { code: "NOT_FOUND", absent: true, retryable: false };
  if (/invalid key|malformed|invalid request|bad request|invalidkey|400/.test(m)) return { code: "MALFORMED_TARGET", absent: false, retryable: false };
  return { code: "TRANSIENT", absent: false, retryable: true };
}

/**
 * Record a private object for durable cleanup, INSIDE the caller's authoritative transaction. The
 * objectKey is server-derived (never client input). Idempotent: `objectKey` is unique, so a repeated
 * enqueue is a no-op (never a duplicate task, never a resurrected COMPLETED/FAILED row). Returns the
 * task id so the caller can attempt an immediate deletion after it commits.
 */
export async function enqueuePrivateObjectCleanup(
  tx: Prisma.TransactionClient,
  input: { objectKey: string; purpose: CleanupPurpose },
): Promise<string> {
  const row = await tx.privateObjectCleanupTask.upsert({
    where: { objectKey: input.objectKey },
    create: { objectKey: input.objectKey, purpose: input.purpose, status: "PENDING", nextAttemptAt: new Date() },
    update: {}, // already queued → idempotent no-op
    select: { id: true },
  });
  return row.id;
}

export type CleanupOutcome = "completed" | "retry" | "failed" | "skipped";

/**
 * Attempt one cleanup task: guarded claim → storage delete (OUTSIDE any tx) → resolve or reschedule.
 * Safe to call from the immediate post-commit path and from the worker; the claim makes concurrent
 * callers converge (only one proceeds). "Object absent" resolves as success. Idempotent.
 */
export async function attemptPrivateObjectCleanup(taskId: string, now: Date = new Date()): Promise<CleanupOutcome> {
  const task = await prisma.privateObjectCleanupTask.findUnique({
    where: { id: taskId },
    select: { id: true, objectKey: true, status: true, attemptCount: true },
  });
  if (!task) return "skipped";
  if (task.status === "COMPLETED" || task.status === "FAILED") return "skipped"; // terminal

  // Guarded single-claim: only the worker whose WHERE still matches (same status AND attemptCount)
  // wins; a competitor's identical update matches 0 rows and backs off. DB-level, not exactly-once
  // across the storage boundary (a double storage delete is harmless — the second is a no-op/absent).
  const claim = await prisma.privateObjectCleanupTask.updateMany({
    where: { id: task.id, status: task.status, attemptCount: task.attemptCount },
    data: { status: "PROCESSING", attemptCount: { increment: 1 }, lastAttemptAt: now },
  });
  if (claim.count === 0) return "skipped"; // another worker claimed it

  const attemptNo = task.attemptCount + 1;
  try {
    await removePrivateObject(task.objectKey); // slow network call — deliberately OUTSIDE any tx
    await prisma.privateObjectCleanupTask.update({ where: { id: task.id }, data: { status: "COMPLETED", completedAt: new Date(), lastError: null } });
    logger.info("privateObjectCleanup.completed", { taskId: task.id, attemptNo });
    return "completed";
  } catch (error) {
    const klass = classifyStorageError(error);
    if (klass.absent) {
      // Already gone == cleaned up.
      await prisma.privateObjectCleanupTask.update({ where: { id: task.id }, data: { status: "COMPLETED", completedAt: new Date(), lastError: null } });
      logger.info("privateObjectCleanup.absent_resolved", { taskId: task.id, attemptNo });
      return "completed";
    }
    const exhausted = !klass.retryable || attemptNo >= MAX_CLEANUP_ATTEMPTS;
    await prisma.privateObjectCleanupTask.update({
      where: { id: task.id },
      data: { status: exhausted ? "FAILED" : "PENDING", lastError: klass.code, nextAttemptAt: new Date(now.getTime() + backoffMs(attemptNo)) },
    });
    // Sanitized operational log only — never the raw storage message/key.
    logger.warn("privateObjectCleanup.attempt_failed", { taskId: task.id, attemptNo, errorClass: klass.code, retryable: klass.retryable && !exhausted, terminal: exhausted });
    return exhausted ? "failed" : "retry";
  }
}

/**
 * INTENT-FIRST upload protection. Call BEFORE writing a new private object: durably records the
 * (server-generated) key as a not-yet-due cleanup task. If the request then dies, or the database
 * write that should persist the document row fails — even because the database itself went away —
 * the record already exists and the worker deletes the object once the grace elapses. Throws if the
 * intent cannot be recorded, so the caller fails closed WITHOUT uploading anything.
 */
export async function registerUploadIntent(objectKey: string): Promise<string> {
  const row = await prisma.privateObjectCleanupTask.create({
    data: { objectKey, purpose: "VEHICLE_DOCUMENT_UPLOAD_INTENT", status: "PENDING", nextAttemptAt: new Date(Date.now() + UPLOAD_INTENT_GRACE_MS) },
    select: { id: true },
  });
  return row.id;
}

/**
 * Release an upload intent INSIDE the transaction that persists the document row for that object:
 * the object is now legitimately referenced, so it must no longer be cleaned up. Returns false when
 * the intent is no longer a releasable PENDING row (the worker already took it) — the caller must
 * then abort its transaction rather than keep a row pointing at an object being deleted.
 */
export async function releaseUploadIntent(tx: Prisma.TransactionClient, objectKey: string): Promise<boolean> {
  const released = await tx.privateObjectCleanupTask.deleteMany({
    where: { objectKey, purpose: "VEHICLE_DOCUMENT_UPLOAD_INTENT", status: "PENDING" },
  });
  return released.count === 1;
}

export type CleanupRunSummary = { claimed: number; completed: number; retried: number; failed: number; skipped: number };

/**
 * The worker (driven by the CRON_SECRET cron). Selects due PENDING tasks and stale-PROCESSING rows
 * abandoned by a crashed worker, bounded batch, oldest-due first; each row is claimed with a guarded
 * update before any storage call. Never holds a DB transaction open across the network delete.
 */
export async function runPrivateObjectCleanup(opts?: { batchSize?: number }): Promise<CleanupRunSummary> {
  const summary: CleanupRunSummary = { claimed: 0, completed: 0, retried: 0, failed: 0, skipped: 0 };
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - STALE_CLAIM_MS);
  const batchSize = opts?.batchSize ?? DEFAULT_BATCH;

  const candidates = await prisma.privateObjectCleanupTask.findMany({
    where: {
      OR: [
        { status: "PENDING", nextAttemptAt: { lte: now } },
        { status: "PROCESSING", lastAttemptAt: { lt: staleCutoff } },
      ],
    },
    orderBy: { nextAttemptAt: "asc" },
    take: batchSize,
    select: { id: true },
  });

  for (const candidate of candidates) {
    const outcome = await attemptPrivateObjectCleanup(candidate.id, now);
    if (outcome === "skipped") continue;
    summary.claimed += 1;
    if (outcome === "completed") summary.completed += 1;
    else if (outcome === "retry") summary.retried += 1;
    else summary.failed += 1;
  }
  return summary;
}
