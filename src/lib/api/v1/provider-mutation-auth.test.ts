import { describe, it, expect, beforeEach, vi } from "vitest";

// This test covers the mutation gate's WIRING, not the auth-error → envelope mapping
// (that is covered exhaustively, with real error classes and no mocks, in
// provider-auth-error.test.ts). Here requireProvider() carries server-only/Better
// Auth deps so it is mocked, and the shared mapper is mocked to a sentinel so the
// assertions never depend on instanceof across the mock boundary. What we prove:
//   1. pre-auth (requireProvider) runs BEFORE the handler,
//   2. a pre-auth failure returns the mapped response and NEVER runs the handler
//      (so the action's own redirect("/") path is unreachable),
//   3. a successful pre-auth runs the handler with the resolved locale,
//   4. a non-auth error (mapper returns null) is rethrown, never masked.
vi.mock("server-only", () => ({}));
const requireProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireProvider: (...a: unknown[]) => requireProviderMock(...a) }));
const mapMock = vi.fn();
vi.mock("./provider-auth-error", () => ({ providerAuthErrorResponse: (...a: unknown[]) => mapMock(...a) }));

const { withApiV1ProviderMutation } = await import("./provider-mutation-auth");

const req = (url = "http://x/api/v1/me/provider/profile?locale=en") => new Request(url, { method: "PATCH" });
beforeEach(() => {
  requireProviderMock.mockReset();
  mapMock.mockReset();
});

describe("withApiV1ProviderMutation — pre-auth wiring", () => {
  it("returns the mapped response and NEVER runs the handler when pre-auth fails", async () => {
    requireProviderMock.mockRejectedValue(new Error("no session"));
    mapMock.mockReturnValue(new Response("mapped", { status: 401 }));
    const handler = vi.fn();

    const res = await withApiV1ProviderMutation(req(), handler);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("mapped");
    // The mutation action is unreachable on a failed pre-auth — its redirect("/")
    // path can never fire.
    expect(handler).not.toHaveBeenCalled();
    expect(mapMock).toHaveBeenCalledTimes(1);
  });

  it("runs the handler with the resolved locale after a successful pre-auth", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "p1" } });
    let seen: string | null = null;
    const res = await withApiV1ProviderMutation(
      new Request("http://x/api/v1/me/provider/profile?locale=ar", { method: "PATCH" }),
      async (ctx) => {
        seen = ctx.locale;
        return new Response("ok");
      }
    );
    expect(requireProviderMock).toHaveBeenCalledTimes(1);
    expect(seen).toBe("ar");
    expect(await res.text()).toBe("ok");
    // Pre-auth succeeded → no mapping needed.
    expect(mapMock).not.toHaveBeenCalled();
  });

  it("maps an auth error thrown by the handler (action-rethrow path) too", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "p1" } });
    mapMock.mockReturnValue(new Response("forbidden", { status: 403 }));
    const res = await withApiV1ProviderMutation(req(), async () => {
      throw new Error("some auth error");
    });
    expect(res.status).toBe(403);
    expect(mapMock).toHaveBeenCalledTimes(1);
  });

  it("rethrows a non-auth error (mapper returns null → real 500 upstream)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "p1" } });
    mapMock.mockReturnValue(null);
    await expect(
      withApiV1ProviderMutation(req(), async () => {
        throw new Error("db exploded");
      })
    ).rejects.toThrow("db exploded");
  });
});
