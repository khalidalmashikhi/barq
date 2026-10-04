import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ONBOARDING_LEASE_MS,
  ONBOARDING_IN_PROGRESS_WAIT_MS,
  ONBOARDING_IN_PROGRESS_POLL_MS,
  ONBOARDING_REQUEST_RETENTION_MS,
  ONBOARDING_PURGE_BATCH,
} from "./onboarding-request-policy";

// Phase 3C Slice 3B — the DURABLE request record behind document-first vehicle onboarding.
//
// `(providerId, idempotencyKey)` is unique, and the row OUTLIVES the vehicle setup it produced:
// cancelling a setup deletes the Asset graph and leaves this row CANCELLED, so the same key can
// never create a second shell or resurrect a cancelled one. See the model comment in schema.prisma
// for the lifecycle. This module owns every transition; nothing else writes the table.
//
// A PENDING request is worked on by exactly ONE attempt at a time, identified by a lease:
//   • a second request with the same key WAITS (bounded) for the live attempt and is answered with
//     its result — it never uploads a second object;
//   • a handled failure RELEASES the lease, so the same key can be retried at once (e.g. with a
//     corrected file);
//   • an attempt that died leaves a lease that EXPIRES, after which a retry takes it over;
//   • completion is a guarded transition on (PENDING, this lease) inside the transaction that
//     creates the shell — an attempt that lost its lease, or whose request was cancelled meanwhile,
//     cannot commit anything.
//
// The key is never logged or audited by this module.

export type OnboardingClaim =
  | { kind: "OWNER"; requestId: string; leaseToken: string }
  | { kind: "COMPLETED"; vehicleId: string }
  | { kind: "CANCELLED" }
  | { kind: "IN_PROGRESS" };

/** Thrown inside the completing transaction when the attempt no longer holds the PENDING request. */
export class OnboardingLeaseLostError extends Error {
  constructor() {
    super("onboarding request is no longer held by this attempt");
    this.name = "OnboardingLeaseLostError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const MAX_CLAIM_PASSES = 500;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type RequestRow = { id: string; status: "PENDING" | "COMPLETED" | "CANCELLED"; assetId: string | null; leaseToken: string | null; leaseExpiresAt: Date | null };

const ROW_SELECT = { id: true, status: true, assetId: true, leaseToken: true, leaseExpiresAt: true } as const;

/** What a request row means to a caller that does not own it. */
function terminalAnswer(row: RequestRow): OnboardingClaim | null {
  if (row.status === "CANCELLED") return { kind: "CANCELLED" };
  if (row.status === "COMPLETED") {
    // A completed request whose setup no longer exists is terminal — never a licence to recreate.
    return row.assetId ? { kind: "COMPLETED", vehicleId: row.assetId } : { kind: "CANCELLED" };
  }
  return null;
}

export type ClaimOptions = { waitMs?: number; pollMs?: number };

/**
 * Claim the request for `(providerId, key)`, or learn its outcome. Exactly one caller becomes OWNER
 * of a PENDING request at a time; everyone else gets the durable result (COMPLETED / CANCELLED) or,
 * if the live attempt does not finish within the bounded wait, IN_PROGRESS.
 */
export async function claimOnboardingRequest(providerId: string, idempotencyKey: string, options: ClaimOptions = {}): Promise<OnboardingClaim> {
  const waitMs = options.waitMs ?? ONBOARDING_IN_PROGRESS_WAIT_MS;
  const pollMs = options.pollMs ?? ONBOARDING_IN_PROGRESS_POLL_MS;
  const deadline = Date.now() + waitMs;

  // Every pass either returns or follows a state change made by another request; the cap only
  // guarantees termination under pathological churn (answering the safe "in progress").
  for (let pass = 0; pass < MAX_CLAIM_PASSES; pass++) {
    const now = new Date();
    const lease = { leaseToken: randomUUID(), leaseExpiresAt: new Date(now.getTime() + ONBOARDING_LEASE_MS), expiresAt: new Date(now.getTime() + ONBOARDING_REQUEST_RETENTION_MS) };

    const row: RequestRow | null = await prisma.vehicleOnboardingRequest.findUnique({
      where: { providerId_idempotencyKey: { providerId, idempotencyKey } },
      select: ROW_SELECT,
    });

    if (!row) {
      try {
        const created = await prisma.vehicleOnboardingRequest.create({
          data: { providerId, idempotencyKey, status: "PENDING", ...lease },
          select: { id: true },
        });
        return { kind: "OWNER", requestId: created.id, leaseToken: lease.leaseToken };
      } catch (error) {
        if (isUniqueViolation(error)) continue; // a concurrent request created it — read it
        throw error;
      }
    }

    const terminal = terminalAnswer(row);
    if (terminal) return terminal;

    const leaseLive = row.leaseToken !== null && row.leaseExpiresAt !== null && row.leaseExpiresAt.getTime() > now.getTime();
    if (!leaseLive) {
      // Released or expired → take it over. Guarded on the lease we saw, so only one taker wins.
      const taken = await prisma.vehicleOnboardingRequest.updateMany({
        where: { id: row.id, status: "PENDING", leaseToken: row.leaseToken },
        data: lease,
      });
      if (taken.count === 1) return { kind: "OWNER", requestId: row.id, leaseToken: lease.leaseToken };
      continue; // someone else took it, or it reached a terminal state — read again
    }

    // A live attempt holds it: wait (bounded) for its outcome rather than doing the work twice.
    if (Date.now() >= deadline) return { kind: "IN_PROGRESS" };
    await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
  return { kind: "IN_PROGRESS" };
}

/** Give a PENDING request back after a handled failure, so the same key can be retried at once. */
export async function releaseOnboardingLease(requestId: string, leaseToken: string): Promise<void> {
  await prisma.vehicleOnboardingRequest.updateMany({
    where: { id: requestId, status: "PENDING", leaseToken },
    data: { leaseToken: null, leaseExpiresAt: null },
  });
}

/**
 * PENDING → COMPLETED, INSIDE the transaction that creates the shell + document. Guarded on the
 * lease: if the request was cancelled or taken over meanwhile, this throws and the whole graph
 * rolls back.
 */
export async function completeOnboardingRequest(tx: Prisma.TransactionClient, params: { requestId: string; leaseToken: string; assetId: string }): Promise<void> {
  const now = new Date();
  const done = await tx.vehicleOnboardingRequest.updateMany({
    where: { id: params.requestId, status: "PENDING", leaseToken: params.leaseToken },
    data: {
      status: "COMPLETED",
      assetId: params.assetId,
      completedAt: now,
      leaseToken: null,
      leaseExpiresAt: null,
      expiresAt: new Date(now.getTime() + ONBOARDING_REQUEST_RETENTION_MS),
    },
  });
  if (done.count !== 1) throw new OnboardingLeaseLostError();
}

/** The outcome of a request this attempt no longer owns (after OnboardingLeaseLostError). */
export async function readOnboardingOutcome(requestId: string): Promise<OnboardingClaim> {
  const row: RequestRow | null = await prisma.vehicleOnboardingRequest.findUnique({ where: { id: requestId }, select: ROW_SELECT });
  if (!row) return { kind: "CANCELLED" }; // purged/unknown → fail closed, never recreate
  return terminalAnswer(row) ?? { kind: "IN_PROGRESS" };
}

/**
 * Tombstone the request that produced `assetId`, INSIDE the transaction that deletes that setup.
 * The row is kept (the FK sets `assetId` NULL when the asset row goes), so a replay of its key is
 * answered "cancelled" and can never create a new shell.
 */
export async function tombstoneOnboardingRequestForAsset(tx: Prisma.TransactionClient, assetId: string): Promise<void> {
  const now = new Date();
  await tx.vehicleOnboardingRequest.updateMany({
    where: { assetId },
    data: { status: "CANCELLED", cancelledAt: now, leaseToken: null, leaseExpiresAt: null, expiresAt: new Date(now.getTime() + ONBOARDING_REQUEST_RETENTION_MS) },
  });
}

export type PurgeSummary = { purged: number };

/**
 * Bounded removal of requests past their retention. A request that is being worked on (PENDING with
 * a live lease) is never removed, and every state change pushes `expiresAt` a full retention period
 * ahead — far beyond the time the browser may still replay the key.
 */
export async function purgeExpiredOnboardingRequests(options: { batchSize?: number; now?: Date } = {}): Promise<PurgeSummary> {
  const now = options.now ?? new Date();
  const take = Math.max(1, Math.min(options.batchSize ?? ONBOARDING_PURGE_BATCH, ONBOARDING_PURGE_BATCH));
  const notInProgress = [{ status: { not: "PENDING" as const } }, { leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }];

  const due = await prisma.vehicleOnboardingRequest.findMany({
    where: { expiresAt: { lte: now }, OR: notInProgress },
    orderBy: { expiresAt: "asc" },
    take,
    select: { id: true },
  });
  if (due.length === 0) return { purged: 0 };

  // Re-assert the predicate at delete time: a row revived between the scan and the delete is kept.
  const removed = await prisma.vehicleOnboardingRequest.deleteMany({
    where: { id: { in: due.map((r) => r.id) }, expiresAt: { lte: now }, OR: notInProgress },
  });
  return { purged: removed.count };
}
