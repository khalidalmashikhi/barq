import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("server-only", () => ({}));

const queryRawMock = vi.fn();
const executeRawMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { $queryRaw: (...a: unknown[]) => queryRawMock(...a), $executeRaw: (...a: unknown[]) => executeRawMock(...a) },
}));
const loggerError = vi.fn();
const loggerWarn = vi.fn();
vi.mock("@/lib/logger", () => ({ logger: { error: (...a: unknown[]) => loggerError(...a), warn: (...a: unknown[]) => loggerWarn(...a), info: vi.fn() } }));

const { consumeRateLimit, sweepExpiredRateLimits } = await import("./durable-rate-limiter");

const inSeconds = (secs: number) => new Date(Date.now() + secs * 1000);

beforeEach(() => {
  queryRawMock.mockReset();
  executeRawMock.mockReset();
  loggerError.mockReset();
  loggerWarn.mockReset();
});

describe("consumeRateLimit — atomic durable fixed window", () => {
  it("allows when the post-increment count is within the limit", async () => {
    queryRawMock.mockResolvedValue([{ count: 1, expiresAt: inSeconds(3600) }]);
    expect(await consumeRateLimit("k", 5, 3600)).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("allows at exactly the limit (count === limit)", async () => {
    queryRawMock.mockResolvedValue([{ count: 5, expiresAt: inSeconds(3600) }]);
    expect((await consumeRateLimit("k", 5, 3600)).allowed).toBe(true);
  });

  it("rejects once count exceeds the limit, deriving retryAfter from expiresAt", async () => {
    queryRawMock.mockResolvedValue([{ count: 6, expiresAt: inSeconds(120) }]);
    const r = await consumeRateLimit("k", 5, 3600);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBeGreaterThan(100);
    expect(r.retryAfterSeconds).toBeLessThanOrEqual(120);
  });

  it("handles a bigint count returned by the driver", async () => {
    queryRawMock.mockResolvedValue([{ count: 6n, expiresAt: inSeconds(120) }]);
    expect((await consumeRateLimit("k", 5, 3600)).allowed).toBe(false);
  });

  it("treats a fresh window (count 1 after reset) as allowed — the TTL/reset is observable", async () => {
    // After the window elapses, the atomic UPSERT restarts the window at count 1.
    queryRawMock.mockResolvedValue([{ count: 1, expiresAt: inSeconds(3600) }]);
    expect((await consumeRateLimit("k", 5, 3600)).allowed).toBe(true);
  });

  it("issues EXACTLY ONE statement — no separate SELECT-then-UPDATE race", async () => {
    queryRawMock.mockResolvedValue([{ count: 1, expiresAt: inSeconds(3600) }]);
    await consumeRateLimit("k", 5, 3600);
    expect(queryRawMock).toHaveBeenCalledTimes(1);
  });

  it("FAILS CLOSED (allowed:false) when the store throws, and never leaks the error to the caller", async () => {
    queryRawMock.mockRejectedValue(new Error("db down: connection refused at 10.0.0.1"));
    const r = await consumeRateLimit("k", 5, 3600);
    expect(r).toEqual({ allowed: false, retryAfterSeconds: 3600 });
    expect(loggerError).toHaveBeenCalled();
  });

  it("FAILS CLOSED when the UPSERT unexpectedly returns no row", async () => {
    queryRawMock.mockResolvedValue([]);
    expect((await consumeRateLimit("k", 5, 3600)).allowed).toBe(false);
  });
});

describe("sweepExpiredRateLimits — bounded, best-effort cleanup", () => {
  it("issues the delete and resolves; never throws even if the delete fails", async () => {
    executeRawMock.mockResolvedValue(3);
    await expect(sweepExpiredRateLimits()).resolves.toBeUndefined();
    expect(executeRawMock).toHaveBeenCalledTimes(1);

    executeRawMock.mockRejectedValue(new Error("boom"));
    await expect(sweepExpiredRateLimits()).resolves.toBeUndefined();
    expect(loggerWarn).toHaveBeenCalled();
  });
});
