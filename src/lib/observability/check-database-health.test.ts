import { describe, it, expect, vi, afterEach } from "vitest";

// Admin Operations Platform — regression tests for the shared
// checkDatabaseHealth() helper, extracted from src/app/api/health/
// route.ts. Both the health endpoint and the admin overview dashboard
// call this same function — these tests cover the helper itself; the
// health endpoint's own response-contract test (src/app/api/health/
// route.test.ts) is unchanged by this extraction.

vi.mock("server-only", () => ({}));

const queryRawMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRawMock(...args),
  },
}));

const { checkDatabaseHealth } = await import("./check-database-health");

afterEach(() => {
  queryRawMock.mockReset();
});

describe("checkDatabaseHealth", () => {
  it("returns 'ok' when the database round trip succeeds", async () => {
    queryRawMock.mockResolvedValue([{ "?column?": 1 }]);

    const result = await checkDatabaseHealth();

    expect(result).toBe("ok");
  });

  it("returns 'error' (never throws, never leaks the underlying error) when the database is unreachable", async () => {
    queryRawMock.mockRejectedValue(new Error("connection refused: password authentication failed for user db_admin"));

    const result = await checkDatabaseHealth();

    expect(result).toBe("error");
  });
});
