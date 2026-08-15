import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {}
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

describe("GET /api/v1/me/provider", () => {
  it("401 UNAUTHORIZED when no session", async () => {
    h.requireAuth.mockRejectedValue(new h.UnauthenticatedError());
    const res = await GET(new Request("http://x/api/v1/me/provider"));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("200 exists:false for an authenticated user with NO provider (never 403)", async () => {
    h.requireAuth.mockResolvedValue({ authUserId: "au1", barqUser: { id: "u1" } });
    h.resolveProviderStatus.mockResolvedValue({ kind: "not_found" });
    const res = await GET(new Request("http://x/api/v1/me/provider"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      exists: false,
      id: null,
      status: null,
      type: null,
      visible: null,
      workspaceAvailable: false,
      verified: false,
    });
  });

  it("200 workspaceAvailable+verified for APPROVED; no internal-field leak", async () => {
    h.requireAuth.mockResolvedValue({ authUserId: "au1", barqUser: { id: "u1" } });
    h.resolveProviderStatus.mockResolvedValue({
      kind: "active",
      provider: {
        id: "p1",
        status: "APPROVED",
        providerType: "COMPANY",
        visible: true,
        userId: "u1",
        approvedByAdminId: "a1",
        contactEmail: "biz@x.com",
      },
    });
    const res = await GET(new Request("http://x/api/v1/me/provider"));
    const body = await res.json();
    expect(body).toEqual({
      exists: true,
      id: "p1",
      status: "APPROVED",
      type: "COMPANY",
      visible: true,
      workspaceAvailable: true,
      verified: true,
    });
    const s = JSON.stringify(body);
    expect(s).not.toContain("userId");
    expect(s).not.toContain("approvedByAdminId");
    expect(s).not.toContain("biz@x.com");
  });
});
