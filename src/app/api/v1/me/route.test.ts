import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {
    code?: string;
    constructor(m?: string, c?: string) {
      super(m);
      this.code = c;
    }
  }
  return { requireAuth: vi.fn(), resolveProviderStatus: vi.fn(), UnauthenticatedError, ForbiddenError };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));
vi.mock("@/lib/auth", () => ({
  requireAuth: (...a: unknown[]) => h.requireAuth(...a),
  resolveProviderStatus: (...a: unknown[]) => h.resolveProviderStatus(...a),
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
}));

const { GET } = await import("./route");

beforeEach(() => {
  h.requireAuth.mockReset();
  h.resolveProviderStatus.mockReset();
});

const USER = { id: "u1", name: "Sara", phoneNumber: "+96890000000", phoneNumberVerified: true, authUserId: "au-secret", status: "ACTIVE" };

describe("GET /api/v1/me", () => {
  it("401 UNAUTHORIZED when no session", async () => {
    h.requireAuth.mockRejectedValue(new h.UnauthenticatedError());
    const res = await GET(new Request("http://x/api/v1/me"));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("403 FORBIDDEN for a SUSPENDED/DEACTIVATED account — unchanged by Gate 0C.1B", async () => {
    // Gate 0C.1B narrowed SIGN-OUT to authentication-only. /me deliberately keeps
    // the full withApiV1Auth status gate: reading your identity is a product
    // capability, whereas destroying your session is not. This test exists so a
    // future change to the shared auth helper cannot quietly relax /me too.
    h.requireAuth.mockRejectedValue(new h.ForbiddenError("Account is not active", "USER_INACTIVE"));
    const res = await GET(new Request("http://x/api/v1/me"));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
    expect(h.resolveProviderStatus).not.toHaveBeenCalled();
  });

  it("200 identity DTO for a customer with NO provider record", async () => {
    h.requireAuth.mockResolvedValue({ authUserId: "au1", barqUser: USER });
    h.resolveProviderStatus.mockResolvedValue({ kind: "not_found" });
    const res = await GET(new Request("http://x/api/v1/me?locale=en"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({
      id: "u1",
      name: "Sara",
      phone: "+96890000000",
      phoneVerified: true,
      locale: "en",
      provider: { exists: false, status: null, type: null, workspaceAvailable: false },
    });
    // no internal/auth leakage
    expect(JSON.stringify(body)).not.toContain("au-secret");
    expect(Object.keys(body)).not.toContain("authUserId");
  });

  it("200 with an APPROVED provider → workspaceAvailable true", async () => {
    h.requireAuth.mockResolvedValue({ authUserId: "au1", barqUser: USER });
    h.resolveProviderStatus.mockResolvedValue({
      kind: "active",
      provider: { status: "APPROVED", providerType: "COMPANY" },
    });
    const body = await (await GET(new Request("http://x/api/v1/me"))).json();
    expect(body.provider).toEqual({ exists: true, status: "APPROVED", type: "COMPANY", workspaceAvailable: true });
  });

  it("200 with an UNDER_REVIEW provider → exists true, workspaceAvailable false", async () => {
    h.requireAuth.mockResolvedValue({ authUserId: "au1", barqUser: USER });
    h.resolveProviderStatus.mockResolvedValue({
      kind: "active",
      provider: { status: "UNDER_REVIEW", providerType: "INDIVIDUAL" },
    });
    const body = await (await GET(new Request("http://x/api/v1/me"))).json();
    expect(body.provider).toEqual({
      exists: true,
      status: "UNDER_REVIEW",
      type: "INDIVIDUAL",
      workspaceAvailable: false,
    });
  });
});
