import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 5.1 (Production Readiness) — regression tests for the daily
// OTP send-limit check, mirroring check-resend-cooldown.test.ts's
// structure exactly: confirms it queries the EXISTING Verification
// table (no new Prisma model), allows sends under the cap, and rejects
// once the cap is reached within the rolling 24h window.

vi.mock("server-only", () => ({}));

const countMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    verification: {
      count: (...args: unknown[]) => countMock(...args),
    },
  },
}));

const { checkDailySendLimit } = await import("./check-daily-send-limit");

afterEach(() => {
  countMock.mockReset();
});

describe("checkDailySendLimit", () => {
  it("allows the request when the count is below the daily cap", async () => {
    countMock.mockResolvedValue(3);

    const result = await checkDailySendLimit("+15005550006", 10);
    expect(result.allowed).toBe(true);
    expect(result.sentInWindow).toBe(3);
  });

  it("queries the Verification table by identifier within a rolling 24h window", async () => {
    countMock.mockResolvedValue(0);
    await checkDailySendLimit("+15005550006", 10);

    expect(countMock).toHaveBeenCalledWith({
      where: { identifier: "+15005550006", createdAt: { gte: expect.any(Date) } },
    });
  });

  it("rejects once the count has reached the daily cap", async () => {
    countMock.mockResolvedValue(10);

    const result = await checkDailySendLimit("+15005550006", 10);
    expect(result.allowed).toBe(false);
    expect(result.sentInWindow).toBe(10);
  });

  it("rejects when the count exceeds the daily cap", async () => {
    countMock.mockResolvedValue(15);

    const result = await checkDailySendLimit("+15005550006", 10);
    expect(result.allowed).toBe(false);
  });
});
