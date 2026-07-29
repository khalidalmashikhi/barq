import { describe, it, expect, vi } from "vitest";

// Phase 5.2 (Production Hardening) — regression tests for the
// AsyncLocalStorage-backed request-id context: getRequestId() reflects
// the id of whichever runWithRequestId() call is currently active, is
// undefined outside any such call, and concurrent calls never leak
// their id into each other (the whole point of using AsyncLocalStorage
// instead of a shared/global variable).

vi.mock("server-only", () => ({}));

const { runWithRequestId, getRequestId } = await import("./request-context");

describe("getRequestId", () => {
  it("returns undefined outside any runWithRequestId call", () => {
    expect(getRequestId()).toBeUndefined();
  });
});

describe("runWithRequestId", () => {
  it("generates a requestId and exposes it via getRequestId() for the duration of the callback", async () => {
    let observedInsideCallback: string | undefined;

    const result = await runWithRequestId(async (requestId) => {
      observedInsideCallback = getRequestId();
      expect(observedInsideCallback).toBe(requestId);
      return "done";
    });

    expect(result).toBe("done");
    expect(observedInsideCallback).toBeDefined();
    expect(getRequestId()).toBeUndefined();
  });

  it("isolates concurrent calls — each sees only its own requestId", async () => {
    const [idA, idB] = await Promise.all([
      runWithRequestId(async (requestId) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(getRequestId()).toBe(requestId);
        return requestId;
      }),
      runWithRequestId(async (requestId) => {
        expect(getRequestId()).toBe(requestId);
        return requestId;
      }),
    ]);

    expect(idA).not.toBe(idB);
  });
});
