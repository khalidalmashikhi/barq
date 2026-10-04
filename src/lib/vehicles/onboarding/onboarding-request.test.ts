import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// Unit suite for the request state machine against a mocked client: which branch a caller takes,
// which guard each transition carries, and what the purge may touch. Concurrency itself (two
// callers, real locks) is proven on PostgreSQL in onboarding-request.dbproof.test.ts.

vi.mock("server-only", () => ({}));
const findUnique = vi.fn();
const create = vi.fn();
const updateMany = vi.fn();
const findMany = vi.fn();
const deleteMany = vi.fn();
const model = {
  findUnique: (...a: unknown[]) => findUnique(...a),
  create: (...a: unknown[]) => create(...a),
  updateMany: (...a: unknown[]) => updateMany(...a),
  findMany: (...a: unknown[]) => findMany(...a),
  deleteMany: (...a: unknown[]) => deleteMany(...a),
};
vi.mock("@/lib/db", () => ({ prisma: { vehicleOnboardingRequest: model } }));

const { claimOnboardingRequest, releaseOnboardingLease, completeOnboardingRequest, readOnboardingOutcome, tombstoneOnboardingRequestForAsset, purgeExpiredOnboardingRequests, OnboardingLeaseLostError } = await import("./onboarding-request");
const { ONBOARDING_LEASE_MS, ONBOARDING_REQUEST_RETENTION_MS, ONBOARDING_PURGE_BATCH } = await import("./onboarding-request-policy");

const KEY = "request-key-0001";
const p2002 = () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "5.22.0" });
const row = (over: Record<string, unknown> = {}) => ({ id: "req-1", status: "PENDING", assetId: null, leaseToken: null, leaseExpiresAt: null, ...over });
const future = (ms = 60_000) => new Date(Date.now() + ms);
const past = (ms = 60_000) => new Date(Date.now() - ms);
const FAST = { waitMs: 60, pollMs: 10 };

beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue({ id: "req-new" });
  updateMany.mockResolvedValue({ count: 1 });
});

describe("claimOnboardingRequest", () => {
  it("no request yet → creates it PENDING with a lease and a retention bound; the caller owns it", async () => {
    findUnique.mockResolvedValue(null);
    const claim = await claimOnboardingRequest("prov-1", KEY);
    expect(claim).toMatchObject({ kind: "OWNER", requestId: "req-new" });
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { providerId_idempotencyKey: { providerId: "prov-1", idempotencyKey: KEY } } }));
    const data = create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).toMatchObject({ providerId: "prov-1", idempotencyKey: KEY, status: "PENDING" });
    if (claim.kind === "OWNER") expect(data.leaseToken).toBe(claim.leaseToken);
    expect((data.leaseExpiresAt as Date).getTime() - Date.now()).toBeGreaterThan(ONBOARDING_LEASE_MS - 5_000);
    expect((data.expiresAt as Date).getTime() - Date.now()).toBeGreaterThan(ONBOARDING_REQUEST_RETENTION_MS - 5_000);
  });

  it("lost the creation race (unique violation) → reads the winner's row instead of failing", async () => {
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(row({ status: "COMPLETED", assetId: "veh-1" }));
    create.mockRejectedValueOnce(p2002());
    expect(await claimOnboardingRequest("prov-1", KEY)).toEqual({ kind: "COMPLETED", vehicleId: "veh-1" });
  });

  it("any other database error is thrown to the caller (which maps it to a safe code)", async () => {
    findUnique.mockResolvedValue(null);
    create.mockRejectedValue(new Error("db down"));
    await expect(claimOnboardingRequest("prov-1", KEY)).rejects.toThrow("db down");
  });

  it("COMPLETED → the existing setup; nothing is written", async () => {
    findUnique.mockResolvedValue(row({ status: "COMPLETED", assetId: "veh-1" }));
    expect(await claimOnboardingRequest("prov-1", KEY)).toEqual({ kind: "COMPLETED", vehicleId: "veh-1" });
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("CANCELLED → terminal; nothing is written", async () => {
    findUnique.mockResolvedValue(row({ status: "CANCELLED" }));
    expect(await claimOnboardingRequest("prov-1", KEY)).toEqual({ kind: "CANCELLED" });
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("COMPLETED but the setup no longer exists → terminal CANCELLED (never a licence to recreate)", async () => {
    findUnique.mockResolvedValue(row({ status: "COMPLETED", assetId: null }));
    expect(await claimOnboardingRequest("prov-1", KEY)).toEqual({ kind: "CANCELLED" });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("PENDING with a RELEASED lease (a handled failure) → taken over, guarded on the lease it saw", async () => {
    findUnique.mockResolvedValue(row({ leaseToken: null, leaseExpiresAt: null }));
    const claim = await claimOnboardingRequest("prov-1", KEY);
    expect(claim).toMatchObject({ kind: "OWNER", requestId: "req-1" });
    expect(updateMany.mock.calls[0]![0].where).toEqual({ id: "req-1", status: "PENDING", leaseToken: null });
  });

  it("PENDING with an EXPIRED lease (a crashed attempt) → taken over, guarded on that exact lease token", async () => {
    findUnique.mockResolvedValue(row({ leaseToken: "old-lease", leaseExpiresAt: past() }));
    expect(await claimOnboardingRequest("prov-1", KEY)).toMatchObject({ kind: "OWNER", requestId: "req-1" });
    expect(updateMany.mock.calls[0]![0].where).toEqual({ id: "req-1", status: "PENDING", leaseToken: "old-lease" });
  });

  it("losing the takeover (someone else took it or it finished) → re-reads and answers with the real outcome", async () => {
    findUnique.mockResolvedValueOnce(row({ leaseToken: "old", leaseExpiresAt: past() })).mockResolvedValueOnce(row({ status: "CANCELLED" }));
    updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await claimOnboardingRequest("prov-1", KEY)).toEqual({ kind: "CANCELLED" });
  });

  it("PENDING with a LIVE lease → waits; answers with the result once the attempt completes", async () => {
    findUnique
      .mockResolvedValueOnce(row({ leaseToken: "live", leaseExpiresAt: future() }))
      .mockResolvedValueOnce(row({ leaseToken: "live", leaseExpiresAt: future() }))
      .mockResolvedValue(row({ status: "COMPLETED", assetId: "veh-9" }));
    expect(await claimOnboardingRequest("prov-1", KEY, { waitMs: 2_000, pollMs: 5 })).toEqual({ kind: "COMPLETED", vehicleId: "veh-9" });
    expect(updateMany).not.toHaveBeenCalled(); // it never touched the live attempt
    expect(create).not.toHaveBeenCalled();
  });

  it("PENDING with a LIVE lease that outlasts the bounded wait → IN_PROGRESS (no takeover, no second attempt)", async () => {
    findUnique.mockResolvedValue(row({ leaseToken: "live", leaseExpiresAt: future() }));
    const started = Date.now();
    expect(await claimOnboardingRequest("prov-1", KEY, FAST)).toEqual({ kind: "IN_PROGRESS" });
    expect(Date.now() - started).toBeLessThan(2_000); // bounded
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe("lease transitions carry their guards", () => {
  it("release: only a PENDING request still held by THIS lease", async () => {
    await releaseOnboardingLease("req-1", "lease-1");
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "req-1", status: "PENDING", leaseToken: "lease-1" }, data: { leaseToken: null, leaseExpiresAt: null } });
  });

  it("complete: PENDING + this lease → COMPLETED with the asset, lease cleared, retention pushed out", async () => {
    const tx = { vehicleOnboardingRequest: model } as never;
    await completeOnboardingRequest(tx, { requestId: "req-1", leaseToken: "lease-1", assetId: "veh-1" });
    const arg = updateMany.mock.calls[0]![0] as { where: unknown; data: Record<string, unknown> };
    expect(arg.where).toEqual({ id: "req-1", status: "PENDING", leaseToken: "lease-1" });
    expect(arg.data).toMatchObject({ status: "COMPLETED", assetId: "veh-1", leaseToken: null, leaseExpiresAt: null });
    expect(arg.data.completedAt).toBeInstanceOf(Date);
  });

  it("complete: a request that was cancelled or taken over meanwhile → throws, so the surrounding transaction rolls back", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    const tx = { vehicleOnboardingRequest: model } as never;
    await expect(completeOnboardingRequest(tx, { requestId: "req-1", leaseToken: "lease-1", assetId: "veh-1" })).rejects.toBeInstanceOf(OnboardingLeaseLostError);
  });

  it("tombstone: every request linked to the asset becomes CANCELLED and is retained (updated, never deleted)", async () => {
    const tx = { vehicleOnboardingRequest: model } as never;
    await tombstoneOnboardingRequestForAsset(tx, "veh-1");
    const arg = updateMany.mock.calls[0]![0] as { where: unknown; data: Record<string, unknown> };
    expect(arg.where).toEqual({ assetId: "veh-1" });
    expect(arg.data).toMatchObject({ status: "CANCELLED", leaseToken: null, leaseExpiresAt: null });
    expect((arg.data.expiresAt as Date).getTime() - Date.now()).toBeGreaterThan(ONBOARDING_REQUEST_RETENTION_MS - 5_000);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("readOnboardingOutcome: an unknown/purged request fails closed as CANCELLED; a still-PENDING one is IN_PROGRESS", async () => {
    findUnique.mockResolvedValueOnce(null);
    expect(await readOnboardingOutcome("gone")).toEqual({ kind: "CANCELLED" });
    findUnique.mockResolvedValueOnce(row());
    expect(await readOnboardingOutcome("req-1")).toEqual({ kind: "IN_PROGRESS" });
    findUnique.mockResolvedValueOnce(row({ status: "COMPLETED", assetId: "veh-2" }));
    expect(await readOnboardingOutcome("req-1")).toEqual({ kind: "COMPLETED", vehicleId: "veh-2" });
  });
});

describe("purgeExpiredOnboardingRequests", () => {
  const NOW = new Date("2026-10-04T12:00:00Z");
  const NOT_IN_PROGRESS = [{ status: { not: "PENDING" } }, { leaseExpiresAt: null }, { leaseExpiresAt: { lte: NOW } }];

  it("selects only rows past retention that are NOT being worked on, oldest first, bounded", async () => {
    findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    deleteMany.mockResolvedValue({ count: 2 });
    expect(await purgeExpiredOnboardingRequests({ now: NOW })).toEqual({ purged: 2 });
    expect(findMany).toHaveBeenCalledWith({ where: { expiresAt: { lte: NOW }, OR: NOT_IN_PROGRESS }, orderBy: { expiresAt: "asc" }, take: ONBOARDING_PURGE_BATCH, select: { id: true } });
    // The delete RE-ASSERTS the predicate: a row revived after the scan is not removed.
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["a", "b"] }, expiresAt: { lte: NOW }, OR: NOT_IN_PROGRESS } });
  });

  it("the batch can be lowered but never raised above the policy bound", async () => {
    findMany.mockResolvedValue([]);
    await purgeExpiredOnboardingRequests({ now: NOW, batchSize: 5 });
    await purgeExpiredOnboardingRequests({ now: NOW, batchSize: 1_000_000 });
    await purgeExpiredOnboardingRequests({ now: NOW, batchSize: 0 });
    expect(findMany.mock.calls.map((c) => (c[0] as { take: number }).take)).toEqual([5, ONBOARDING_PURGE_BATCH, 1]);
  });

  it("nothing due → no delete at all", async () => {
    findMany.mockResolvedValue([]);
    expect(await purgeExpiredOnboardingRequests({ now: NOW })).toEqual({ purged: 0 });
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
