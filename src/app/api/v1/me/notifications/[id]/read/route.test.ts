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

const markNotificationReadMock = vi.fn();
vi.mock("@/lib/notifications/mark-notification-read", () => ({
  markNotificationRead: (...a: unknown[]) => markNotificationReadMock(...a),
}));

const { POST } = await import("./route");

beforeEach(() => {
  h.requireAuth.mockReset();
  markNotificationReadMock.mockReset();
  h.requireAuth.mockResolvedValue({ authUserId: "au1", barqUser: { id: "u1" } });
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request("http://x/api/v1/me/notifications/n1/read?locale=en", { method: "POST" });

describe("POST /api/v1/me/notifications/{id}/read", () => {
  it("401 unauthenticated", async () => {
    h.requireAuth.mockRejectedValue(new h.UnauthenticatedError());
    const res = await POST(req(), params("n1"));
    expect(res.status).toBe(401);
    expect(markNotificationReadMock).not.toHaveBeenCalled();
  });

  it("200 { ok: true } marking own unread notification read", async () => {
    markNotificationReadMock.mockResolvedValue({ ok: true });
    const res = await POST(req(), params("n1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(markNotificationReadMock).toHaveBeenCalledWith("n1");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("another user's notification is a safe no-op (domain scopes by userId → { ok: true }, nothing revealed)", async () => {
    markNotificationReadMock.mockResolvedValue({ ok: true }); // updateMany matched 0 rows, still ok
    const res = await POST(req(), params("n1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("repeated mark-read is idempotent (still { ok: true })", async () => {
    markNotificationReadMock.mockResolvedValue({ ok: true });
    expect((await (await POST(req(), params("n1"))).json())).toEqual({ ok: true });
    expect((await (await POST(req(), params("n1"))).json())).toEqual({ ok: true });
  });

  it("400 INVALID_INPUT for a malformed id", async () => {
    markNotificationReadMock.mockResolvedValue({ ok: false });
    const res = await POST(req(), params("not-a-uuid"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_INPUT");
  });
});
