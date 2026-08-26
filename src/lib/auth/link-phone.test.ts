import { describe, it, expect, vi, beforeEach } from "vitest";

// AUTH-DUAL-IDENTITY-1 — orchestration tests for the "Add phone" server actions.
// Better Auth's phone updatePhoneNumber primitive is mocked at auth.api; these pin
// BARQ's policy layer: auth required, Oman canonicalization, already-has-phone
// guard, generic ACCOUNT_LINK_CONFLICT (AuthUser AND domain User, never merge/leak),
// rate limiting, delegation to auth.api, and the domain User.phoneNumber sync.
// normalizeOmanPhone runs REAL.

vi.mock("server-only", () => ({}));

class UnauthenticatedError extends Error {}
class ForbiddenError extends Error {}
const requireAuthMock = vi.fn();
vi.mock("./index", () => ({
  requireAuth: (...a: unknown[]) => requireAuthMock(...a),
  UnauthenticatedError,
  ForbiddenError,
}));

const sendPhoneOtpMock = vi.fn();
const verifyPhoneMock = vi.fn();
vi.mock("./server", () => ({
  auth: { api: { sendPhoneNumberOTP: (...a: unknown[]) => sendPhoneOtpMock(...a), verifyPhoneNumber: (...a: unknown[]) => verifyPhoneMock(...a) } },
}));

const authUserFindUniqueMock = vi.fn();
const userFindUniqueMock = vi.fn();
const userUpdateMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    authUser: { findUnique: (...a: unknown[]) => authUserFindUniqueMock(...a) },
    user: { findUnique: (...a: unknown[]) => userFindUniqueMock(...a), update: (...a: unknown[]) => userUpdateMock(...a) },
  },
}));

const consumeRateLimitMock = vi.fn();
vi.mock("@/lib/rate-limit/durable-rate-limiter", () => ({ consumeRateLimit: (...a: unknown[]) => consumeRateLimitMock(...a) }));
vi.mock("@/lib/rate-limit/client-ip", () => ({ resolveClientIp: () => "1.2.3.4", hmacRateLimitKey: (v: string) => `hmac(${v})` }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { requestPhoneLink, verifyPhoneLink } = await import("./link-phone");
const { APIError } = await import("better-auth/api");
const { Prisma } = await import("@prisma/client");

const ME = "authuser-me";
const MY_USER = "barq-user-me";
const OTHER = "authuser-other";
const PHONE = "+96898115159"; // normalizeOmanPhone("98115159")

function primeOwners(opts: { authOwner?: string | null; userOwner?: string | null } = {}) {
  authUserFindUniqueMock.mockResolvedValue(opts.authOwner ? { id: opts.authOwner } : null);
  userFindUniqueMock.mockResolvedValue(opts.userOwner ? { id: opts.userOwner } : null);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ authUserId: ME, barqUser: { id: MY_USER, phoneNumber: null } });
  consumeRateLimitMock.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  sendPhoneOtpMock.mockResolvedValue({ code: "sent" });
  verifyPhoneMock.mockResolvedValue({ status: true });
  userUpdateMock.mockResolvedValue({ id: MY_USER });
  primeOwners();
});

describe("requestPhoneLink", () => {
  it("blocks unauthenticated (NOT_AUTHENTICATED); no OTP sent", async () => {
    requireAuthMock.mockRejectedValue(new UnauthenticatedError());
    expect(await requestPhoneLink("98115159")).toEqual({ ok: false, error: "NOT_AUTHENTICATED" });
    expect(sendPhoneOtpMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed / non-Oman number (INVALID_PHONE)", async () => {
    expect(await requestPhoneLink("12345")).toEqual({ ok: false, error: "INVALID_PHONE" });
    expect(await requestPhoneLink("+9715012345678")).toEqual({ ok: false, error: "INVALID_PHONE" });
    expect(sendPhoneOtpMock).not.toHaveBeenCalled();
  });

  it("refuses when the account already has a phone (ALREADY_HAS_PHONE)", async () => {
    requireAuthMock.mockResolvedValue({ authUserId: ME, barqUser: { id: MY_USER, phoneNumber: "+96891112222" } });
    expect(await requestPhoneLink("98115159")).toEqual({ ok: false, error: "ALREADY_HAS_PHONE" });
    expect(sendPhoneOtpMock).not.toHaveBeenCalled();
  });

  it("ACCOUNT_LINK_CONFLICT when the phone belongs to another AuthUser; no send, no leak", async () => {
    primeOwners({ authOwner: OTHER });
    const res = await requestPhoneLink("98115159");
    expect(res).toEqual({ ok: false, error: "ACCOUNT_LINK_CONFLICT" });
    expect(sendPhoneOtpMock).not.toHaveBeenCalled();
    expect(JSON.stringify(res)).not.toContain(OTHER);
  });

  it("ACCOUNT_LINK_CONFLICT when the phone belongs to another domain User (legacy unlinked)", async () => {
    primeOwners({ userOwner: "barq-user-other" });
    expect(await requestPhoneLink("98115159")).toEqual({ ok: false, error: "ACCOUNT_LINK_CONFLICT" });
  });

  it("RATE_LIMITED when a limiter denies", async () => {
    consumeRateLimitMock.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 60 });
    expect(await requestPhoneLink("98115159")).toEqual({ ok: false, error: "RATE_LIMITED" });
    expect(sendPhoneOtpMock).not.toHaveBeenCalled();
  });

  it("happy path: canonicalizes + delegates to auth.api.sendPhoneNumberOTP with the +968 number", async () => {
    expect(await requestPhoneLink("98115159")).toEqual({ ok: true });
    expect(sendPhoneOtpMock).toHaveBeenCalledWith(expect.objectContaining({ body: { phoneNumber: PHONE } }));
  });
});

describe("verifyPhoneLink", () => {
  it("blocks unauthenticated", async () => {
    requireAuthMock.mockRejectedValue(new UnauthenticatedError());
    expect(await verifyPhoneLink("98115159", "123456")).toEqual({ ok: false, error: "NOT_AUTHENTICATED" });
    expect(verifyPhoneMock).not.toHaveBeenCalled();
  });

  it("requires a non-empty otp", async () => {
    expect(await verifyPhoneLink("98115159", "  ")).toEqual({ ok: false, error: "INVALID_OTP" });
  });

  it("happy path: updatePhoneNumber on the SAME AuthUser + syncs domain User.phoneNumber", async () => {
    expect(await verifyPhoneLink("98115159", "123456")).toEqual({ ok: true });
    expect(verifyPhoneMock).toHaveBeenCalledWith(
      expect.objectContaining({ body: { phoneNumber: PHONE, code: "123456", updatePhoneNumber: true, disableSession: true } })
    );
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: MY_USER },
      data: { phoneNumber: PHONE, phoneNumberVerified: true },
    });
  });

  it("wrong/expired OTP -> INVALID_OTP; no domain sync", async () => {
    verifyPhoneMock.mockRejectedValue(new APIError("BAD_REQUEST", { code: "INVALID_OTP", message: "x" }));
    expect(await verifyPhoneLink("98115159", "000000")).toEqual({ ok: false, error: "INVALID_OTP" });
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("PHONE_NUMBER_EXIST -> ACCOUNT_LINK_CONFLICT", async () => {
    verifyPhoneMock.mockRejectedValue(new APIError("BAD_REQUEST", { code: "PHONE_NUMBER_EXIST", message: "x" }));
    expect(await verifyPhoneLink("98115159", "123456")).toEqual({ ok: false, error: "ACCOUNT_LINK_CONFLICT" });
  });

  it("a domain-User unique violation (legacy owner) -> ACCOUNT_LINK_CONFLICT", async () => {
    userUpdateMock.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "x" }));
    expect(await verifyPhoneLink("98115159", "123456")).toEqual({ ok: false, error: "ACCOUNT_LINK_CONFLICT" });
  });
});
