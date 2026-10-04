import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
const removePrivateObjectMock = vi.fn();
class StorageNotConfiguredError extends Error {}
vi.mock("@/lib/storage/storage", () => ({
  removePrivateObject: (...a: unknown[]) => removePrivateObjectMock(...a),
  StorageNotConfiguredError,
}));

const findUnique = vi.fn();
const updateMany = vi.fn();
const update = vi.fn();
const findMany = vi.fn();
const upsert = vi.fn();
const txUpsert = vi.fn();
const create = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    privateObjectCleanupTask: {
      create: (...a: unknown[]) => create(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
      update: (...a: unknown[]) => update(...a),
      findMany: (...a: unknown[]) => findMany(...a),
      upsert: (...a: unknown[]) => upsert(...a),
    },
    $transaction: async (cb: (tx: unknown) => unknown) => cb({ privateObjectCleanupTask: { upsert: (...a: unknown[]) => txUpsert(...a) } }),
  },
}));

const { enqueuePrivateObjectCleanup, attemptPrivateObjectCleanup, runPrivateObjectCleanup, registerUploadIntent, releaseUploadIntent, MAX_CLEANUP_ATTEMPTS, UPLOAD_INTENT_GRACE_MS } = await import("./private-object-cleanup");

beforeEach(() => {
  vi.clearAllMocks();
  updateMany.mockResolvedValue({ count: 1 }); // claim wins by default
  update.mockResolvedValue({});
  txUpsert.mockResolvedValue({ id: "task-1" });
});

const pending = (over: Record<string, unknown> = {}) => ({ id: "task-1", objectKey: "k/old.pdf", status: "PENDING", attemptCount: 0, ...over });

describe("enqueuePrivateObjectCleanup", () => {
  it("upserts on objectKey (idempotent — never a duplicate) with a server-derived key + purpose", async () => {
    const tx = { privateObjectCleanupTask: { upsert: (...a: unknown[]) => txUpsert(...a) } } as never;
    const id = await enqueuePrivateObjectCleanup(tx, { objectKey: "k/old.pdf", purpose: "VEHICLE_REGISTRATION_ONBOARDING" });
    expect(id).toBe("task-1");
    const call = txUpsert.mock.calls[0]![0] as { where: unknown; create: Record<string, unknown>; update: unknown };
    expect(call.where).toEqual({ objectKey: "k/old.pdf" });
    expect(call.create).toMatchObject({ objectKey: "k/old.pdf", purpose: "VEHICLE_REGISTRATION_ONBOARDING", status: "PENDING" });
    expect(call.update).toEqual({}); // existing row is a no-op (never resurrected)
  });
});

describe("upload intent (intent-first)", () => {
  it("registerUploadIntent records a PENDING task that is NOT due until the grace elapses", async () => {
    create.mockResolvedValue({ id: "intent-1" });
    const before = Date.now();
    expect(await registerUploadIntent("k/new.pdf")).toBe("intent-1");
    const data = (create.mock.calls[0]![0] as { data: { objectKey: string; purpose: string; status: string; nextAttemptAt: Date } }).data;
    expect(data).toMatchObject({ objectKey: "k/new.pdf", purpose: "VEHICLE_DOCUMENT_UPLOAD_INTENT", status: "PENDING" });
    expect(data.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + UPLOAD_INTENT_GRACE_MS - 1000);
  });

  it("registerUploadIntent THROWS when it cannot be recorded (caller must fail closed)", async () => {
    create.mockRejectedValue(new Error("db down"));
    await expect(registerUploadIntent("k/new.pdf")).rejects.toThrow();
  });

  it("releaseUploadIntent removes only a still-PENDING intent for that exact key", async () => {
    const txDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = { privateObjectCleanupTask: { deleteMany: txDeleteMany } } as never;
    expect(await releaseUploadIntent(tx, "k/new.pdf")).toBe(true);
    expect(txDeleteMany).toHaveBeenCalledWith({ where: { objectKey: "k/new.pdf", purpose: "VEHICLE_DOCUMENT_UPLOAD_INTENT", status: "PENDING" } });
    txDeleteMany.mockResolvedValue({ count: 0 }); // the worker already claimed it
    expect(await releaseUploadIntent(tx, "k/new.pdf")).toBe(false);
  });
});

describe("attemptPrivateObjectCleanup", () => {
  it("storage success → COMPLETED (resolved), not retried", async () => {
    findUnique.mockResolvedValue(pending());
    removePrivateObjectMock.mockResolvedValue(undefined);
    expect(await attemptPrivateObjectCleanup("task-1")).toBe("completed");
    expect(update.mock.calls.at(-1)![0]).toMatchObject({ data: { status: "COMPLETED", lastError: null } });
  });

  it("object already absent (not-found) → COMPLETED (counts as cleaned)", async () => {
    findUnique.mockResolvedValue(pending());
    removePrivateObjectMock.mockRejectedValue(new Error("Object not found: key"));
    expect(await attemptPrivateObjectCleanup("task-1")).toBe("completed");
    expect(update.mock.calls.at(-1)![0]).toMatchObject({ data: { status: "COMPLETED" } });
  });

  it("transient failure → back to PENDING, attempt incremented at claim, backoff scheduled, SANITIZED code only", async () => {
    findUnique.mockResolvedValue(pending({ attemptCount: 1 }));
    removePrivateObjectMock.mockRejectedValue(new Error("ECONNRESET socket hang up https://signed.example/secret?token=abc"));
    expect(await attemptPrivateObjectCleanup("task-1")).toBe("retry");
    // Claim incremented attemptCount.
    expect(updateMany.mock.calls[0]![0]).toMatchObject({ data: { status: "PROCESSING", attemptCount: { increment: 1 } } });
    const data = (update.mock.calls.at(-1)![0] as { data: Record<string, unknown> }).data;
    expect(data.status).toBe("PENDING");
    expect(data.lastError).toBe("TRANSIENT"); // never the raw message / signed URL
    expect(String(data.lastError)).not.toContain("signed.example");
    expect(data.nextAttemptAt).toBeInstanceOf(Date);
  });

  it("transient failure at the last attempt → FAILED (exhausted, visible to ops)", async () => {
    findUnique.mockResolvedValue(pending({ attemptCount: MAX_CLEANUP_ATTEMPTS - 1 }));
    removePrivateObjectMock.mockRejectedValue(new Error("temporary 503"));
    expect(await attemptPrivateObjectCleanup("task-1")).toBe("failed");
    expect(update.mock.calls.at(-1)![0]).toMatchObject({ data: { status: "FAILED", lastError: "TRANSIENT" } });
  });

  it("malformed target → FAILED immediately (not retryable), sanitized code", async () => {
    findUnique.mockResolvedValue(pending());
    removePrivateObjectMock.mockRejectedValue(new Error("Invalid key: bad request 400"));
    expect(await attemptPrivateObjectCleanup("task-1")).toBe("failed");
    expect(update.mock.calls.at(-1)![0]).toMatchObject({ data: { status: "FAILED", lastError: "MALFORMED_TARGET" } });
  });

  it("storage-not-configured → retryable (leaves PENDING so it retries once configured)", async () => {
    findUnique.mockResolvedValue(pending());
    removePrivateObjectMock.mockRejectedValue(new StorageNotConfiguredError("no bucket"));
    expect(await attemptPrivateObjectCleanup("task-1")).toBe("retry");
    expect(update.mock.calls.at(-1)![0]).toMatchObject({ data: { status: "PENDING", lastError: "STORAGE_NOT_CONFIGURED" } });
  });

  it("lost claim (updateMany count 0) → skipped, no storage call", async () => {
    findUnique.mockResolvedValue(pending());
    updateMany.mockResolvedValue({ count: 0 });
    expect(await attemptPrivateObjectCleanup("task-1")).toBe("skipped");
    expect(removePrivateObjectMock).not.toHaveBeenCalled();
  });

  it("terminal task (COMPLETED/FAILED) → skipped, never re-claimed", async () => {
    findUnique.mockResolvedValue(pending({ status: "COMPLETED" }));
    expect(await attemptPrivateObjectCleanup("task-1")).toBe("skipped");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("missing task → skipped", async () => {
    findUnique.mockResolvedValue(null);
    expect(await attemptPrivateObjectCleanup("gone")).toBe("skipped");
  });
});

describe("runPrivateObjectCleanup", () => {
  it("selects DUE pending + stale-processing, oldest-due first, bounded batch", async () => {
    findMany.mockResolvedValue([{ id: "task-1" }]);
    findUnique.mockResolvedValue(pending());
    removePrivateObjectMock.mockResolvedValue(undefined);
    const summary = await runPrivateObjectCleanup({ batchSize: 10 });
    const where = (findMany.mock.calls[0]![0] as { where: { OR: unknown[] }; take: number }).where;
    expect(where.OR).toHaveLength(2); // due PENDING + stale PROCESSING
    expect((findMany.mock.calls[0]![0] as { take: number }).take).toBe(10);
    expect(summary).toMatchObject({ claimed: 1, completed: 1 });
  });
});
