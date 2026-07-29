import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 5.2 (Production Hardening) — regression tests for logger.ts's
// new auto-attached requestId behavior: every log line merges in the
// active request context's id when one exists, and omits the key
// entirely when it doesn't (never a literal `"requestId": undefined`
// polluting every log line outside a traced Route Handler).

vi.mock("server-only", () => ({}));

const getRequestIdMock = vi.fn();

vi.mock("@/lib/observability/request-context", () => ({
  getRequestId: () => getRequestIdMock(),
}));

const { logger } = await import("./logger");

const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

afterEach(() => {
  getRequestIdMock.mockReset();
  consoleLogSpy.mockClear();
  consoleWarnSpy.mockClear();
  consoleErrorSpy.mockClear();
});

describe("logger", () => {
  it("attaches requestId to the log line when a request context is active", () => {
    getRequestIdMock.mockReturnValue("req-123");

    logger.info("some.event", { userId: "user-1" });

    const line = JSON.parse(consoleLogSpy.mock.calls[0]![0] as string);
    expect(line).toMatchObject({ message: "some.event", userId: "user-1", requestId: "req-123" });
  });

  it("omits requestId entirely when no request context is active", () => {
    getRequestIdMock.mockReturnValue(undefined);

    logger.error("some.error", { userId: "user-1" });

    const line = JSON.parse(consoleErrorSpy.mock.calls[0]![0] as string);
    expect(line).toMatchObject({ message: "some.error", userId: "user-1" });
    expect(line).not.toHaveProperty("requestId");
  });

  it("still produces the standard {timestamp, level, message} shape", () => {
    getRequestIdMock.mockReturnValue(undefined);

    logger.warn("some.warning");

    const line = JSON.parse(consoleWarnSpy.mock.calls[0]![0] as string);
    expect(line).toMatchObject({ level: "warn", message: "some.warning" });
    expect(typeof line.timestamp).toBe("string");
  });
});
