import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// Gate 7 — the cleanup runner is INTERNAL only: the single way to trigger it is the
// CRON_SECRET-protected cron. There is no customer/provider endpoint that runs deletion or exposes
// the queue / object keys. Mirrors the booking-email cron's auth contract exactly.

vi.mock("@/lib/observability/with-request-tracing", () => ({ withRequestTracing: (_n: string, fn: () => unknown) => fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const runMock = vi.fn();
vi.mock("@/lib/storage/cleanup/private-object-cleanup", () => ({ runPrivateObjectCleanup: (...a: unknown[]) => runMock(...a) }));
const purgeMock = vi.fn();
vi.mock("@/lib/vehicles/onboarding/onboarding-request", () => ({ purgeExpiredOnboardingRequests: (...a: unknown[]) => purgeMock(...a) }));

const { GET } = await import("./route");

const ORIGINAL = process.env.CRON_SECRET;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "s3cret";
  runMock.mockResolvedValue({ claimed: 0, completed: 0, retried: 0, failed: 0, skipped: 0 });
  purgeMock.mockResolvedValue({ purged: 0 });
});
afterAll(() => { process.env.CRON_SECRET = ORIGINAL; });

function req(auth?: string) {
  return new Request("https://barq.test/api/cron/cleanup-private-objects", auth ? { headers: { authorization: auth } } : {});
}

describe("GET /api/cron/cleanup-private-objects", () => {
  it("401 without the CRON_SECRET bearer — never runs the worker", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("401 with a wrong bearer", async () => {
    const res = await GET(req("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("200 and runs the worker with the correct bearer", async () => {
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it("accepts NO client-supplied object key or target — the worker is called with no arguments", async () => {
    await GET(req("Bearer s3cret"));
    expect(runMock.mock.calls[0]!.length).toBe(0);
  });

  it("never runs the onboarding-request purge without the bearer", async () => {
    await GET(req("Bearer wrong"));
    expect(purgeMock).not.toHaveBeenCalled();
  });

  it("then runs the BOUNDED onboarding-request purge (default batch, no client input); the response body is unchanged", async () => {
    purgeMock.mockResolvedValue({ purged: 7 });
    const res = await GET(req("Bearer s3cret"));
    expect(purgeMock).toHaveBeenCalledTimes(1);
    expect(purgeMock.mock.calls[0]!.length).toBe(0);
    expect(runMock.mock.invocationCallOrder[0]!).toBeLessThan(purgeMock.mock.invocationCallOrder[0]!);
    expect(await res.json()).toEqual({ claimed: 0, completed: 0, retried: 0, failed: 0, skipped: 0 });
  });

  it("a purge failure is isolated: the object cleanup result is still returned with 200", async () => {
    purgeMock.mockRejectedValue(new Error("db down"));
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ claimed: 0, completed: 0, retried: 0, failed: 0, skipped: 0 });
  });
});
