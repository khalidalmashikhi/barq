import { describe, it, expect, vi, afterEach } from "vitest";

// Phase E.3 — regression tests for getContractExecutionStatus():
// returns null (not an error) when no execution has started, and the
// correct status/signatures summary when one exists.

vi.mock("server-only", () => ({}));

const findUniqueMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: { contractExecution: { findUnique: (...args: unknown[]) => findUniqueMock(...args) } },
}));

const { getContractExecutionStatus } = await import("./get-execution-status");

afterEach(() => {
  findUniqueMock.mockReset();
});

describe("getContractExecutionStatus", () => {
  it("returns null when no execution exists for this contract", async () => {
    findUniqueMock.mockResolvedValue(null);

    const result = await getContractExecutionStatus("contract-1");
    expect(result).toBeNull();
  });

  it("returns the status, expiry, and ordered signatures when an execution exists", async () => {
    const signedAt1 = new Date("2026-07-20T10:00:00Z");
    const signedAt2 = new Date("2026-07-20T11:00:00Z");
    findUniqueMock.mockResolvedValue({
      id: "execution-1",
      status: "EXECUTED",
      expiresAt: new Date("2026-07-27T00:00:00Z"),
      signatures: [
        { signerType: "CUSTOMER", signedAt: signedAt1, method: "INTERNAL" },
        { signerType: "PROVIDER", signedAt: signedAt2, method: "INTERNAL" },
      ],
    });

    const result = await getContractExecutionStatus("contract-1");
    expect(result).toEqual({
      executionId: "execution-1",
      status: "EXECUTED",
      expiresAt: new Date("2026-07-27T00:00:00Z"),
      signatures: [
        { signerType: "CUSTOMER", signedAt: signedAt1, method: "INTERNAL" },
        { signerType: "PROVIDER", signedAt: signedAt2, method: "INTERNAL" },
      ],
    });
  });
});
