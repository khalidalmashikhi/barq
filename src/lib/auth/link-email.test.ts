import { describe, it, expect, vi, beforeEach } from "vitest";

// AUTH-EMAIL-LINK-1 — orchestration tests for the BARQ-owned "Add email" actions.
// Better Auth's change-email primitive (which does updateUser on the SAME AuthUser)
// is mocked at auth.api; these tests pin BARQ's policy layer around it: auth
// required, canonical normalization, synthetic-domain reject, already-has-email
// guard, generic ACCOUNT_LINK_CONFLICT (never merges / never leaks), rate limiting,
// and correct delegation to auth.api. normalizeEmail runs REAL.

vi.mock("server-only", () => ({}));

class UnauthenticatedError extends Error {}
class ForbiddenError extends Error {}
const requireAuthMock = vi.fn();
vi.mock("./index", () => ({
  requireAuth: (...a: unknown[]) => requireAuthMock(...a),
  UnauthenticatedError,
  ForbiddenError,
}));

const requestEmailChangeMock = vi.fn();
const changeEmailMock = vi.fn();
vi.mock("./server", () => ({
  auth: { api: { requestEmailChangeEmailOTP: (...a: unknown[]) => requestEmailChangeMock(...a), changeEmailEmailOTP: (...a: unknown[]) => changeEmailMock(...a) } },
}));

const authUserFindUniqueMock = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { authUser: { findUnique: (...a: unknown[]) => authUserFindUniqueMock(...a) } } }));

const consumeRateLimitMock = vi.fn();
vi.mock("@/lib/rate-limit/durable-rate-limiter", () => ({ consumeRateLimit: (...a: unknown[]) => consumeRateLimitMock(...a) }));
vi.mock("@/lib/rate-limit/client-ip", () => ({ resolveClientIp: () => "1.2.3.4", hmacRateLimitKey: (v: string) => `hmac(${v})` }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { requestEmailLink, verifyEmailLink } = await import("./link-email");
const { APIError } = await import("better-auth/api");

const ME = "authuser-me";
const OTHER = "authuser-other";

// authUser.findUnique routes by the `where` shape: by id (current user) vs by email (conflict).
function primeAuthUser(opts: { myEmail?: string | null; myVerified?: boolean; ownerOfNewEmail?: string | null } = {}) {
  authUserFindUniqueMock.mockImplementation(({ where }: { where: { id?: string; email?: string } }) => {
    if (where.id) return Promise.resolve({ email: opts.myEmail ?? "98115159@phone.barq.internal", emailVerified: opts.myVerified ?? false });
    if (where.email) return Promise.resolve(opts.ownerOfNewEmail ? { id: opts.ownerOfNewEmail } : null);
    return Promise.resolve(null);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ authUserId: ME, barqUser: { id: "barq-user" } });
  consumeRateLimitMock.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  requestEmailChangeMock.mockResolvedValue({ success: true });
  changeEmailMock.mockResolvedValue({ success: true });
  primeAuthUser();
});

describe("requestEmailLink", () => {
  it("blocks an unauthenticated caller (NOT_AUTHENTICATED); never calls auth.api", async () => {
    requireAuthMock.mockRejectedValue(new UnauthenticatedError());
    expect(await requestEmailLink("new@example.com")).toEqual({ ok: false, error: "NOT_AUTHENTICATED" });
    expect(requestEmailChangeMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed email (INVALID_EMAIL)", async () => {
    expect(await requestEmailLink("not-an-email")).toEqual({ ok: false, error: "INVALID_EMAIL" });
    expect(requestEmailChangeMock).not.toHaveBeenCalled();
  });

  it("rejects a synthetic @phone.barq.internal address (INVALID_EMAIL)", async () => {
    expect(await requestEmailLink("96890000000@phone.barq.internal")).toEqual({ ok: false, error: "INVALID_EMAIL" });
  });

  it("refuses when the account already has a real verified email (ALREADY_HAS_EMAIL)", async () => {
    primeAuthUser({ myEmail: "existing@example.com", myVerified: true });
    expect(await requestEmailLink("new@example.com")).toEqual({ ok: false, error: "ALREADY_HAS_EMAIL" });
    expect(requestEmailChangeMock).not.toHaveBeenCalled();
  });

  it("returns generic ACCOUNT_LINK_CONFLICT when the email belongs to another AuthUser; never merges, never calls auth.api", async () => {
    primeAuthUser({ ownerOfNewEmail: OTHER });
    const res = await requestEmailLink("taken@example.com");
    expect(res).toEqual({ ok: false, error: "ACCOUNT_LINK_CONFLICT" });
    expect(requestEmailChangeMock).not.toHaveBeenCalled();
    // The result is only a code — no other-account metadata.
    expect(JSON.stringify(res)).not.toContain(OTHER);
  });

  it("is idempotent-safe when the email is already on MY own AuthUser (proceeds, not a conflict)", async () => {
    primeAuthUser({ ownerOfNewEmail: ME });
    expect(await requestEmailLink("mine@example.com")).toEqual({ ok: true });
  });

  it("RATE_LIMITED when a limiter denies", async () => {
    consumeRateLimitMock.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 30 });
    expect(await requestEmailLink("new@example.com")).toEqual({ ok: false, error: "RATE_LIMITED" });
    expect(requestEmailChangeMock).not.toHaveBeenCalled();
  });

  it("happy path: normalizes + delegates to auth.api.requestEmailChangeEmailOTP with the new email", async () => {
    expect(await requestEmailLink("  New.User@Example.COM ")).toEqual({ ok: true });
    expect(requestEmailChangeMock).toHaveBeenCalledWith(expect.objectContaining({ body: { newEmail: "new.user@example.com" } }));
  });

  it("maps a delivery-unavailable failure from auth.api", async () => {
    requestEmailChangeMock.mockRejectedValue(new APIError("SERVICE_UNAVAILABLE", { code: "EMAIL_DELIVERY_UNAVAILABLE", message: "x" }));
    expect(await requestEmailLink("new@example.com")).toEqual({ ok: false, error: "EMAIL_DELIVERY_UNAVAILABLE" });
  });
});

describe("verifyEmailLink", () => {
  it("blocks unauthenticated (NOT_AUTHENTICATED)", async () => {
    requireAuthMock.mockRejectedValue(new UnauthenticatedError());
    expect(await verifyEmailLink("new@example.com", "123456")).toEqual({ ok: false, error: "NOT_AUTHENTICATED" });
    expect(changeEmailMock).not.toHaveBeenCalled();
  });

  it("requires a non-empty otp", async () => {
    expect(await verifyEmailLink("new@example.com", "  ")).toEqual({ ok: false, error: "INVALID_OTP" });
    expect(changeEmailMock).not.toHaveBeenCalled();
  });

  it("happy path: delegates to auth.api.changeEmailEmailOTP (same AuthUser mutation) and returns ok", async () => {
    expect(await verifyEmailLink("New@Example.com", "123456")).toEqual({ ok: true });
    expect(changeEmailMock).toHaveBeenCalledWith(expect.objectContaining({ body: { newEmail: "new@example.com", otp: "123456" } }));
  });

  it("wrong/expired OTP -> INVALID_OTP (no mutation persisted by us)", async () => {
    changeEmailMock.mockRejectedValue(new APIError("BAD_REQUEST", { code: "INVALID_OTP", message: "x" }));
    expect(await verifyEmailLink("new@example.com", "000000")).toEqual({ ok: false, error: "INVALID_OTP" });

    changeEmailMock.mockRejectedValue(new APIError("BAD_REQUEST", { code: "OTP_EXPIRED", message: "x" }));
    expect(await verifyEmailLink("new@example.com", "000000")).toEqual({ ok: false, error: "INVALID_OTP" });
  });

  it("a late taken-email -> ACCOUNT_LINK_CONFLICT (Better Auth 'Email already in use')", async () => {
    changeEmailMock.mockRejectedValue(new APIError("BAD_REQUEST", { message: "Email already in use" }));
    expect(await verifyEmailLink("new@example.com", "123456")).toEqual({ ok: false, error: "ACCOUNT_LINK_CONFLICT" });
  });
});
