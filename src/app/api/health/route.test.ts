import { describe, it, expect, vi, afterEach } from "vitest";

// Phase D.3 (Production Hardening) — regression tests for the new
// health endpoint: verifies both the happy path (database reachable)
// and the degraded path (database query throws) return the correct
// HTTP status and body shape, and — just as importantly — that
// neither path ever includes a raw error message/stack or any
// connection-string-shaped value in the response body.
//
// Phase 5.2 (Production Hardening) — the route now goes through
// withRequestTracing(), which transitively imports the "server-only"
// -marked src/lib/observability/request-context.ts; mocked here the
// same way every other server-only-adjacent test in this codebase does.
//
// Production Hardening (this phase) — the route now also reports
// resolved OTP/payment provider health and overall environment
// completeness; these tests exercise the default (unconfigured-beyond-
// the-bare-minimum) shape only — checkOtpProviderHealth.test.ts /
// checkPaymentProviderHealth.test.ts / checkEnvironmentHealth.test.ts
// cover each checker's own branches directly.

vi.mock("server-only", () => ({}));

const queryRawMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRawMock(...args),
  },
}));

const { GET } = await import("./route");

afterEach(() => {
  queryRawMock.mockReset();
});

describe("GET /api/health", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 200 with status ok when the database is reachable and nothing else is misconfigured", async () => {
    queryRawMock.mockResolvedValue([{ "?column?": 1 }]);
    // checkEnvironmentHealth() parses real process.env against the full
    // production schema — stub the required variables explicitly
    // (mirrors scripts/env-schema.test.ts's own validBase) rather than
    // depending on whatever happens to be ambient in the test runner.
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/barq");
    vi.stubEnv("BETTER_AUTH_SECRET", "a".repeat(32));
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_BETTER_AUTH_URL", "http://localhost:3000");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.database).toBe("ok");
    expect(body.otpProvider).toBe("console");
    expect(body.paymentProvider).toBe("NONE");
    expect(body.environment).toBe("ok");
    expect(typeof body.version).toBe("string");
    expect(typeof body.timestamp).toBe("string");
  });

  it("returns 503 with status degraded when the database query fails, without leaking the raw error", async () => {
    queryRawMock.mockRejectedValue(new Error("connection to server at 10.0.0.5 failed: password authentication failed"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.database).toBe("error");
    // The raw exception message (which could include a host/credential
    // hint, as the mock above deliberately simulates) must never reach
    // the response body — only the literal string "error".
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("10.0.0.5");
    expect(serialized).not.toContain("password authentication failed");
  });

  it("returns 503 with status degraded when the OTP provider is misconfigured, even though the database is reachable", async () => {
    queryRawMock.mockResolvedValue([{ "?column?": 1 }]);
    vi.stubEnv("OTP_PROVIDER", "twilio");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.database).toBe("ok");
    expect(body.otpProvider).toBe("misconfigured");
  });

  it("returns 503 with status degraded when the payment provider is misconfigured", async () => {
    queryRawMock.mockResolvedValue([{ "?column?": 1 }]);
    vi.stubEnv("PAYMENT_PROVIDER", "STRIPE");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.paymentProvider).toBe("misconfigured");
  });
});
