import { describe, it, expect, vi, afterEach } from "vitest";

// Phase D.4 — regression tests for the resend-cooldown check: confirms
// it queries the EXISTING Verification table (no new Prisma model),
// allows a first-ever request through, rejects a too-soon resend with
// the correct remaining-seconds figure, and allows a resend once the
// cooldown has elapsed.

vi.mock("server-only", () => ({}));

const findFirstMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    verification: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
  },
}));

const { checkResendCooldown } = await import("./check-resend-cooldown");

afterEach(() => {
  findFirstMock.mockReset();
});

describe("checkResendCooldown", () => {
  it("allows the request when no prior verification row exists", async () => {
    findFirstMock.mockResolvedValue(null);

    const result = await checkResendCooldown("+15005550006", 30);
    expect(result.allowed).toBe(true);
    expect(result.retryAfterSeconds).toBe(0);
  });

  it("queries the Verification table by identifier, most-recent first", async () => {
    findFirstMock.mockResolvedValue(null);
    await checkResendCooldown("+15005550006", 30);

    expect(findFirstMock).toHaveBeenCalledWith({
      where: { identifier: "+15005550006" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
  });

  it("rejects a resend within the cooldown window, reporting remaining seconds", async () => {
    findFirstMock.mockResolvedValue({ createdAt: new Date(Date.now() - 10_000) });

    const result = await checkResendCooldown("+15005550006", 30);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(19);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(20);
  });

  it("allows a resend once the cooldown has fully elapsed", async () => {
    findFirstMock.mockResolvedValue({ createdAt: new Date(Date.now() - 31_000) });

    const result = await checkResendCooldown("+15005550006", 30);
    expect(result.allowed).toBe(true);
    expect(result.retryAfterSeconds).toBe(0);
  });
});
