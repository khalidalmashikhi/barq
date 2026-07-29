import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

// Phase E.3 — regression tests for the public GET
// /api/contracts/verify/[token] endpoint: no authentication required,
// returns {valid:false} for an unknown/malformed token, and minimal,
// non-sensitive JSON for a valid one.

const verifyContractTokenMock = vi.fn();

vi.mock("@/lib/contracts/execution", () => ({
  verifyContractToken: (...args: unknown[]) => verifyContractTokenMock(...args),
}));

const { GET } = await import("./route");

function makeParams(token: string) {
  return { params: Promise.resolve({ token }) };
}

afterEach(() => {
  verifyContractTokenMock.mockReset();
});

describe("GET /api/contracts/verify/[token]", () => {
  it("returns {valid:false} for an empty token without querying the database", async () => {
    const response = await GET(new Request("http://localhost"), makeParams(""));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ valid: false });
    expect(verifyContractTokenMock).not.toHaveBeenCalled();
  });

  it("returns {valid:false} for a suspiciously long token without querying the database", async () => {
    const response = await GET(new Request("http://localhost"), makeParams("a".repeat(300)));
    const body = await response.json();

    expect(body).toEqual({ valid: false });
    expect(verifyContractTokenMock).not.toHaveBeenCalled();
  });

  it("returns the verification result for a real token, with no sensitive fields", async () => {
    verifyContractTokenMock.mockResolvedValue({
      valid: true,
      contractNumber: "BARQ-2026-000001",
      status: "EXECUTED",
      executedAt: new Date("2026-07-20T10:00:00Z"),
    });

    const response = await GET(new Request("http://localhost"), makeParams("real-token"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.valid).toBe(true);
    expect(body.contractNumber).toBe("BARQ-2026-000001");
    expect(body).not.toHaveProperty("content");
    expect(body).not.toHaveProperty("terms");
  });
});
