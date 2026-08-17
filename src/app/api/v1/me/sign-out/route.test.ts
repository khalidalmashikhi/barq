import { describe, it, expect, beforeEach, vi } from "vitest";

// Follows the established /api/v1 route-test pattern: mock the auth module and the
// tracing wrapper, then call the exported handler directly and assert the Response.
const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {
    code?: string;
    constructor(m?: string, c?: string) {
      super(m);
      this.code = c;
    }
  }
  return {
    getSession: vi.fn(),
    requireAuth: vi.fn(),
    signOut: vi.fn(),
    headers: vi.fn(),
    UnauthenticatedError,
    ForbiddenError,
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: (...a: unknown[]) => h.headers(...a) }));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));
// requireAuth/ForbiddenError are still exported here because withApiV1Auth (used
// by every OTHER /api/v1 route) imports them from the same module. This route no
// longer reaches them — several tests below assert exactly that.
vi.mock("@/lib/auth", () => ({
  getSession: (...a: unknown[]) => h.getSession(...a),
  requireAuth: (...a: unknown[]) => h.requireAuth(...a),
  auth: { api: { signOut: (...a: unknown[]) => h.signOut(...a) } },
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
}));

const { POST } = await import("./route");

/**
 * A valid Better Auth session. The BARQ account status is deliberately NOT part
 * of this shape: after Gate 0C.1B the route reads Better Auth's session and
 * nothing else, so account status cannot reach the decision at all.
 */
const SESSION = {
  session: { id: "s1", token: "live-token", userId: "au-secret" },
  user: { id: "au-secret" },
};

/** The expired-cookie Set-Cookie Better Auth emits on sign-out. */
const EXPIRED_COOKIE =
  "better-auth.session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax";

function req(headerInit?: HeadersInit) {
  return new Request("http://x/api/v1/me/sign-out", { method: "POST", headers: headerInit });
}

function signOutHeaders(...cookies: string[]) {
  const hdrs = new Headers();
  for (const c of cookies) hdrs.append("set-cookie", c);
  return { headers: hdrs, response: { success: true } };
}

beforeEach(() => {
  h.getSession.mockReset();
  h.requireAuth.mockReset();
  h.signOut.mockReset();
  h.headers.mockReset();
  h.headers.mockResolvedValue(new Headers({ cookie: "better-auth.session_token=live-token" }));
});

describe("POST /api/v1/me/sign-out", () => {
  it("401 UNAUTHORIZED when there is no session", async () => {
    h.getSession.mockResolvedValue(null);

    const res = await POST(req());

    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
    // The session must never be touched for an unauthenticated caller.
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it("401 UNAUTHORIZED for an invalid or expired session, without calling signOut", async () => {
    // Better Auth returns null for absent, malformed AND expired sessions alike;
    // it does not distinguish them, so all three are one 401.
    h.getSession.mockResolvedValue(null);

    const res = await POST(req({ cookie: "better-auth.session_token=expired-or-forged" }));

    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
    expect(h.signOut).not.toHaveBeenCalled();
  });

  // Gate 0C.1B — the fix. A SUSPENDED/DEACTIVATED account keeps a VALID Better
  // Auth session until it expires. Gating sign-out on ACTIVE status returned 403
  // before auth.api.signOut() could run, so the one user who most needed to
  // destroy their session was the one user who could not.
  it.each(["ACTIVE", "SUSPENDED", "DEACTIVATED"])(
    "a %s account with a valid session signs out: 200, signOut called, expired cookie forwarded",
    async () => {
      h.getSession.mockResolvedValue(SESSION);
      h.signOut.mockResolvedValue(signOutHeaders(EXPIRED_COOKIE));

      const res = await POST(req());

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(h.signOut).toHaveBeenCalledTimes(1);
      expect(res.headers.get("set-cookie")).toContain("Expires=Thu, 01 Jan 1970");
    }
  );

  it("never consults the BARQ account-status gate, so no status can block sign-out", async () => {
    // The structural proof behind the it.each above: requireAuth() is where the
    // SUSPENDED/DEACTIVATED denylist lives. This route must not reach it at all,
    // which is stronger than asserting two specific statuses happen to pass.
    h.getSession.mockResolvedValue(SESSION);
    h.signOut.mockResolvedValue(signOutHeaders(EXPIRED_COOKIE));

    await POST(req());

    expect(h.requireAuth).not.toHaveBeenCalled();
  });

  it("200 { success: true } and delegates invalidation to Better Auth's server API", async () => {
    h.getSession.mockResolvedValue(SESSION);
    h.signOut.mockResolvedValue(signOutHeaders(EXPIRED_COOKIE));

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    // Invalidation is Better Auth's job — this route must not reimplement it.
    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(h.signOut).toHaveBeenCalledWith(expect.objectContaining({ returnHeaders: true }));
  });

  it("forwards Better Auth's expired session cookie so the cookie is actually cleared", async () => {
    h.getSession.mockResolvedValue(SESSION);
    h.signOut.mockResolvedValue(signOutHeaders(EXPIRED_COOKIE));

    const res = await POST(req());

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("better-auth.session_token=");
    expect(setCookie).toContain("Expires=Thu, 01 Jan 1970");
    // The deletion cookie is authored by Better Auth, not hand-rolled here.
    expect(setCookie).toContain("HttpOnly");
  });

  it("preserves EVERY Set-Cookie separately when Better Auth emits more than one", async () => {
    h.getSession.mockResolvedValue(SESSION);
    const second = "better-auth.session_data=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
    h.signOut.mockResolvedValue(signOutHeaders(EXPIRED_COOKIE, second));

    const res = await POST(req());

    expect(res.headers.getSetCookie()).toHaveLength(2);
    expect(res.headers.getSetCookie()[0]).toContain("session_token=");
    expect(res.headers.getSetCookie()[1]).toContain("session_data=");
  });

  it("succeeds with NO Origin header — the native-client requirement", async () => {
    // Better Auth's own /api/auth/sign-out rejects this exact request shape with
    // FORBIDDEN/MISSING_OR_NULL_ORIGIN. This route must not, and must not require a
    // fabricated browser Origin to work.
    h.getSession.mockResolvedValue(SESSION);
    h.signOut.mockResolvedValue(signOutHeaders(EXPIRED_COOKIE));

    const request = req({ cookie: "better-auth.session_token=live-token" });
    expect(request.headers.get("origin")).toBeNull();
    expect(request.headers.get("referer")).toBeNull();

    const res = await POST(request);

    expect(res.status).toBe(200);
  });

  it("never returns a session token or cookie value in the JSON body", async () => {
    h.getSession.mockResolvedValue(SESSION);
    h.signOut.mockResolvedValue(signOutHeaders(EXPIRED_COOKIE));

    const res = await POST(req());
    const raw = JSON.stringify(await res.json());

    expect(raw).toBe('{"success":true}');
    expect(raw).not.toContain("live-token");
    expect(raw).not.toContain("session_token");
    expect(raw).not.toContain("au-secret");
  });

  it("propagates a Better Auth failure instead of falsely reporting success", async () => {
    // If the session row could not be deleted, the client must keep its session and
    // retry — never clear locally while the server session stays alive.
    h.getSession.mockResolvedValue(SESSION);
    h.signOut.mockRejectedValue(new Error("database unavailable"));

    await expect(POST(req())).rejects.toThrow("database unavailable");
  });

  it("does not 500 on a malformed or unrelated cookie", async () => {
    // Better Auth's getSession is the authority; a junk cookie is simply no session.
    h.headers.mockResolvedValue(new Headers({ cookie: "unrelated=abc; garbage" }));
    h.getSession.mockResolvedValue(null);

    const res = await POST(req({ cookie: "unrelated=abc; garbage" }));

    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });
});
