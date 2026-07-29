import { describe, it, expect, vi, afterEach } from "vitest";

// Phase E.3 — regression tests for contract verification (requirement
// #6): token generation is opaque/unguessable-looking (not a
// sequence), verifyContractToken returns minimal info for a valid
// token and {valid:false} only for an unknown one, and the QR
// -placeholder URL builder composes correctly.

vi.mock("server-only", () => ({}));

const findUniqueMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    contractExecution: { findUnique: (...args: unknown[]) => findUniqueMock(...args) },
  },
}));

const { generateVerificationToken, verifyContractToken, getVerificationUrl } = await import("./verification");

afterEach(() => {
  findUniqueMock.mockReset();
});

describe("generateVerificationToken", () => {
  it("generates a reasonably long, URL-safe, non-sequential token", () => {
    const token = generateVerificationToken();
    expect(token.length).toBeGreaterThanOrEqual(24);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates a different token on every call", () => {
    const a = generateVerificationToken();
    const b = generateVerificationToken();
    expect(a).not.toBe(b);
  });
});

describe("verifyContractToken", () => {
  it("returns {valid:false} and nothing else for an unknown token", async () => {
    findUniqueMock.mockResolvedValue(null);

    const result = await verifyContractToken("nonexistent-token");
    expect(result).toEqual({ valid: false });
  });

  it("returns minimal, non-sensitive info for a valid, executed contract", async () => {
    findUniqueMock.mockResolvedValue({
      status: "EXECUTED",
      updatedAt: new Date("2026-07-20T10:00:00Z"),
      contract: { contractNumber: "BARQ-2026-000001" },
    });

    const result = await verifyContractToken("real-token");
    expect(result).toEqual({
      valid: true,
      contractNumber: "BARQ-2026-000001",
      status: "EXECUTED",
      executedAt: new Date("2026-07-20T10:00:00Z"),
    });
  });

  it("omits executedAt for a valid but not-yet-executed contract", async () => {
    findUniqueMock.mockResolvedValue({
      status: "PENDING_CUSTOMER",
      updatedAt: new Date("2026-07-20T10:00:00Z"),
      contract: { contractNumber: "BARQ-2026-000002" },
    });

    const result = await verifyContractToken("real-token-2");
    expect(result.executedAt).toBeUndefined();
    expect(result.status).toBe("PENDING_CUSTOMER");
  });
});

describe("getVerificationUrl", () => {
  it("composes the public verification URL from a base URL and token", () => {
    expect(getVerificationUrl("abc123", "https://barq.example")).toBe(
      "https://barq.example/api/contracts/verify/abc123"
    );
  });

  it("strips a trailing slash from the base URL", () => {
    expect(getVerificationUrl("abc123", "https://barq.example/")).toBe(
      "https://barq.example/api/contracts/verify/abc123"
    );
  });
});
