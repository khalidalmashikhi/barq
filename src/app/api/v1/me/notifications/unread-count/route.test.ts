import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {}
  return { requireAuth: vi.fn(), UnauthenticatedError, ForbiddenError };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));
vi.mock("@/lib/auth", () => ({
  requireAuth: (...a: unknown[]) => h.requireAuth(...a),
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
}));

const getUnreadCountMock = vi.fn();
vi.mock("@/lib/notifications/get-unread-count", () => ({
  getUnreadCount: (...a: unknown[]) => getUnreadCountMock(...a),
}));

const { GET } = await import("./route");

beforeEach(() => {
  h.requireAuth.mockReset();
  getUnreadCountMock.mockReset();
});

describe("GET /api/v1/me/notifications/unread-count", () => {
  it("401 without a session", async () => {
    h.requireAuth.mockRejectedValue(new h.UnauthenticatedError());
    const res = await GET(new Request("http://x/api/v1/me/notifications/unread-count"));
    expect(res.status).toBe(401);
    expect(getUnreadCountMock).not.toHaveBeenCalled();
  });

  it("200 returns the authenticated user's unread count", async () => {
    h.requireAuth.mockResolvedValue({ authUserId: "au1", barqUser: { id: "u1" } });
    getUnreadCountMock.mockResolvedValue(7);
    const res = await GET(new Request("http://x/api/v1/me/notifications/unread-count"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ unreadCount: 7 });
  });
});
