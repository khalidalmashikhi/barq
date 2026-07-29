import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.13 (Invoice Foundation) — regression tests for
// generateInvoiceNumber(), mirroring contract-number.test.ts's shape:
// confirms the format ("<prefix>-<year>-<6-digit sequence>"), that the
// prefix is configurable, and that it reads from the Postgres sequence
// via $queryRaw (not computed some other way that could race or repeat).

vi.mock("server-only", () => ({}));

const queryRawMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRawMock(...args),
  },
}));

const { generateInvoiceNumber } = await import("./generate-invoice-number");

afterEach(() => {
  queryRawMock.mockReset();
});

describe("generateInvoiceNumber", () => {
  it("formats as PREFIX-YEAR-000123, defaulting to BARQ", async () => {
    queryRawMock.mockResolvedValue([{ value: 123n }]);

    const result = await generateInvoiceNumber({ now: new Date("2026-07-20T00:00:00Z") });
    expect(result).toBe("BARQ-2026-000123");
  });

  it("honors a custom prefix", async () => {
    queryRawMock.mockResolvedValue([{ value: 7n }]);

    const result = await generateInvoiceNumber({ prefix: "GCC", now: new Date("2027-01-01T00:00:00Z") });
    expect(result).toBe("GCC-2027-000007");
  });

  it("pads beyond 6 digits without truncating", async () => {
    queryRawMock.mockResolvedValue([{ value: 1234567n }]);

    const result = await generateInvoiceNumber({ now: new Date("2026-01-01T00:00:00Z") });
    expect(result).toBe("BARQ-2026-1234567");
  });

  it("throws if the sequence query unexpectedly returns no row", async () => {
    queryRawMock.mockResolvedValue([]);

    await expect(generateInvoiceNumber()).rejects.toThrow(/no row/);
  });
});
