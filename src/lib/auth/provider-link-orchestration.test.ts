import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IdentitySide } from "./identity-convergence-policy";

// AUTH-PROVIDER-LINK gate 3A — tests for the dual-proof orchestration. The pure classifier
// (identity-convergence-policy) runs FOR REAL so routing genuinely matches policy; the two
// terminal mutations (convergeCustomerIdentityByPhone, linkProviderCredential), Better Auth
// (send/verify), the identity loaders, the rate-limiter and audit are mocked. These prove:
// no OTP during assessment; OTP only after explicit consent (offer); the terminal
// transaction is invoked only after a valid OTP and never on a failed/absent proof; identity
// is derived from the session and never from client input; provider/customer eligible offers
// are externally indistinguishable; Staff/Admin/privileged/history cases stay generic
// SUPPORT_REQUIRED; the verify uses disableSession (no A session / no third AuthUser); and
// the engine's result maps to a non-enumerating public completion.

vi.mock("server-only", () => ({}));

class UnauthenticatedError extends Error {}
class ForbiddenError extends Error {}
const requireAuthMock = vi.fn();
vi.mock("./index", () => ({
  requireAuth: (...a: unknown[]) => requireAuthMock(...a),
  UnauthenticatedError,
  ForbiddenError,
}));

const sendOtpMock = vi.fn();
const verifyPhoneMock = vi.fn();
vi.mock("./server", () => ({
  auth: { api: { sendPhoneNumberOTP: (...a: unknown[]) => sendOtpMock(...a), verifyPhoneNumber: (...a: unknown[]) => verifyPhoneMock(...a) } },
}));

// Real synthetic-email detection (pure) for the real classifier.
vi.mock("./linked-email", () => ({
  isSyntheticAuthEmail: (e: string | null | undefined) => typeof e === "string" && e.toLowerCase().endsWith("@phone.barq.internal"),
}));

const findPhoneOwnerUserIdMock = vi.fn();
const loadSideMock = vi.fn();
vi.mock("./identity-side-loader", () => ({
  findPhoneOwnerUserId: (...a: unknown[]) => findPhoneOwnerUserIdMock(...a),
  loadIdentitySide: (...a: unknown[]) => loadSideMock(...a),
}));

const linkProviderCredentialMock = vi.fn();
vi.mock("./provider-credential-link", () => ({
  linkProviderCredential: (...a: unknown[]) => linkProviderCredentialMock(...a),
}));

const convergeMock = vi.fn();
vi.mock("./identity-convergence", () => ({
  convergeCustomerIdentityByPhone: (...a: unknown[]) => convergeMock(...a),
}));

// Deterministic normalization: anything starting with "+" is a valid E.164; "" / "bad" invalid.
vi.mock("@/lib/phone/normalize-international-phone", () => ({
  normalizeInternationalPhone: (input: string) =>
    typeof input === "string" && input.startsWith("+") ? { ok: true, e164: input } : { ok: false, reason: "INVALID_NUMBER" },
}));

const consumeRateLimitMock = vi.fn();
vi.mock("@/lib/rate-limit/durable-rate-limiter", () => ({ consumeRateLimit: (...a: unknown[]) => consumeRateLimitMock(...a) }));
vi.mock("@/lib/rate-limit/client-ip", () => ({ resolveClientIp: () => "1.2.3.4", hmacRateLimitKey: (v: string) => `hmac(${v})` }));
vi.mock("@/lib/otp/otp-rate-limit-config", () => ({
  getOtpVerifyIpRateLimit: () => ({ limit: 30, windowSeconds: 3600 }),
  otpVerifyIpKey: (k: string) => `v:${k}`,
}));
vi.mock("@/lib/otp/audit", () => ({ maskPhoneNumber: (p: string) => `***${p.slice(-4)}` }));

const loggerWarnMock = vi.fn();
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: (...a: unknown[]) => loggerWarnMock(...a), error: vi.fn() } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const auditCreateMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({
  recordAuditEvent: (params: unknown) => auditCreateMock(params),
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));

const { assessIdentityLink, offerIdentityLink, completeIdentityLink } = await import("./provider-link-orchestration");

// ── fixtures ────────────────────────────────────────────────────────────────────────
const PHONE = "+96892123456";

function side(over: Partial<IdentitySide> & Pick<IdentitySide, "userId" | "authUserId">): IdentitySide {
  const hasProvider = over.hasProvider ?? false;
  const hasStaffOrAdmin = over.hasStaffOrAdmin ?? false;
  return {
    status: "ACTIVE" as IdentitySide["status"],
    createdAt: new Date("2024-01-01T00:00:00Z"),
    userPhone: null,
    authEmail: null,
    authEmailVerified: false,
    authPhone: null,
    authPhoneVerified: false,
    hasProvider,
    hasStaffOrAdmin,
    hasPrivilege: hasProvider || hasStaffOrAdmin || over.hasPrivilege === true,
    hasCustomer: false,
    customerId: null,
    hasMeaningfulHistory: false,
    ...over,
  };
}

// CURRENT B — ordinary customer with a real verified email, no phone, no privilege, no history.
function ordinaryB(over: Partial<IdentitySide> = {}): IdentitySide {
  return side({
    userId: "B",
    authUserId: "authB",
    authEmail: "b@example.com",
    authEmailVerified: true,
    hasCustomer: true,
    customerId: "custB",
    ...over,
  });
}

// OWNER A — a Provider on a verified phone P, synthetic email, no customer.
function providerA(over: Partial<IdentitySide> = {}): IdentitySide {
  return side({
    userId: "A",
    authUserId: "authA",
    authEmail: `${PHONE}@phone.barq.internal`,
    authEmailVerified: true,
    authPhone: PHONE,
    authPhoneVerified: true,
    userPhone: PHONE,
    hasProvider: true,
    createdAt: new Date("2023-01-01T00:00:00Z"),
    ...over,
  });
}

// A second ordinary customer C owning verified phone P, no email, no history (older) — the
// classic customer-convergence owner.
function ordinaryOwnerC(over: Partial<IdentitySide> = {}): IdentitySide {
  return side({
    userId: "C",
    authUserId: "authC",
    authPhone: PHONE,
    authPhoneVerified: true,
    userPhone: PHONE,
    hasCustomer: true,
    customerId: "custC",
    createdAt: new Date("2022-01-01T00:00:00Z"),
    ...over,
  });
}

function configure(opts: { current: IdentitySide; owner: IdentitySide | null; ownerUserId?: string | null }) {
  requireAuthMock.mockResolvedValue({ authUserId: opts.current.authUserId, barqUser: { id: opts.current.userId, status: "ACTIVE" } });
  findPhoneOwnerUserIdMock.mockResolvedValue(opts.ownerUserId === undefined ? (opts.owner?.userId ?? null) : opts.ownerUserId);
  loadSideMock.mockImplementation(async (_db: unknown, userId: string) =>
    userId === opts.current.userId ? opts.current : opts.owner && userId === opts.owner.userId ? opts.owner : null
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  consumeRateLimitMock.mockResolvedValue({ allowed: true });
  sendOtpMock.mockResolvedValue({});
  verifyPhoneMock.mockResolvedValue({ status: true, token: null });
  linkProviderCredentialMock.mockResolvedValue({ ok: true, survivorUserId: "A" });
  convergeMock.mockResolvedValue({ ok: true });
});

function lastAssessmentReason(): string | undefined {
  const call = [...loggerWarnMock.mock.calls].reverse().find((c) => c[0] === "auth.identity_link_assessment");
  return call?.[1]?.reason as string | undefined;
}

// ── ASSESSMENT (§16.1-6) ──────────────────────────────────────────────────────────────
describe("assessIdentityLink", () => {
  it("1. customer convergence is available (unchanged behavior)", async () => {
    configure({ current: ordinaryB(), owner: ordinaryOwnerC() });
    expect(await assessIdentityLink(PHONE)).toEqual({ status: "LINK_AVAILABLE" });
    expect(sendOtpMock).not.toHaveBeenCalled();
  });

  it("2. provider link is available (internally PROVIDER, publicly indistinguishable)", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    expect(await assessIdentityLink(PHONE)).toEqual({ status: "LINK_AVAILABLE" });
    expect(sendOtpMock).not.toHaveBeenCalled();
  });

  it("3. Staff owner is blocked (generic SUPPORT_REQUIRED)", async () => {
    configure({ current: ordinaryB(), owner: providerA({ hasStaffOrAdmin: true }) });
    expect(await assessIdentityLink(PHONE)).toEqual({ status: "SUPPORT_REQUIRED" });
    expect(lastAssessmentReason()).toBe("STAFF_ADMIN_BLOCKED");
  });

  it("4. Admin owner is blocked (generic SUPPORT_REQUIRED)", async () => {
    configure({ current: ordinaryB(), owner: side({ userId: "A", authUserId: "authA", authPhone: PHONE, authPhoneVerified: true, hasStaffOrAdmin: true }) });
    expect(await assessIdentityLink(PHONE)).toEqual({ status: "SUPPORT_REQUIRED" });
    expect(lastAssessmentReason()).toBe("STAFF_ADMIN_BLOCKED");
  });

  it("5. current identity privileged → blocked", async () => {
    configure({ current: ordinaryB({ hasProvider: true }), owner: providerA() });
    expect(await assessIdentityLink(PHONE)).toEqual({ status: "SUPPORT_REQUIRED" });
    expect(lastAssessmentReason()).toBe("CURRENT_PRIVILEGED");
  });

  it("6. history-bearing B → blocked", async () => {
    configure({ current: ordinaryB({ hasMeaningfulHistory: true }), owner: providerA() });
    expect(await assessIdentityLink(PHONE)).toEqual({ status: "SUPPORT_REQUIRED" });
    expect(lastAssessmentReason()).toBe("CURRENT_HISTORY_UNSAFE");
  });

  it("NOT_APPLICABLE when P is unowned, and never sends an OTP", async () => {
    configure({ current: ordinaryB(), owner: null, ownerUserId: null });
    expect(await assessIdentityLink(PHONE)).toEqual({ status: "NOT_APPLICABLE" });
    expect(sendOtpMock).not.toHaveBeenCalled();
  });

  it("NOT_AUTHENTICATED when not signed in", async () => {
    requireAuthMock.mockRejectedValue(new UnauthenticatedError());
    expect(await assessIdentityLink(PHONE)).toEqual({ status: "NOT_AUTHENTICATED" });
  });

  it("INVALID_PHONE for an unparseable number", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    expect(await assessIdentityLink("bad")).toEqual({ status: "INVALID_PHONE" });
  });

  it("provider-eligible and customer-eligible assessments are byte-identical (anti-enumeration)", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    const provider = await assessIdentityLink(PHONE);
    configure({ current: ordinaryB(), owner: ordinaryOwnerC() });
    const customer = await assessIdentityLink(PHONE);
    expect(provider).toEqual(customer);
    expect(provider).toEqual({ status: "LINK_AVAILABLE" });
  });
});

// ── OTP SEND (§16.7-10) ────────────────────────────────────────────────────────────────
describe("offerIdentityLink", () => {
  it("7. provider eligible + explicit consent (offer) → sends OTP", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    expect(await offerIdentityLink(PHONE)).toEqual({ status: "OWNERSHIP_VERIFICATION_REQUIRED" });
    expect(sendOtpMock).toHaveBeenCalledTimes(1);
    expect(sendOtpMock.mock.calls[0]![0].body).toEqual({ phoneNumber: PHONE });
    expect(linkProviderCredentialMock).not.toHaveBeenCalled();
  });

  it("customer eligible → same OTP mechanism, indistinguishable result", async () => {
    configure({ current: ordinaryB(), owner: ordinaryOwnerC() });
    expect(await offerIdentityLink(PHONE)).toEqual({ status: "OWNERSHIP_VERIFICATION_REQUIRED" });
    expect(sendOtpMock).toHaveBeenCalledTimes(1);
  });

  it("9. blocked pair (Staff owner) → no OTP", async () => {
    configure({ current: ordinaryB(), owner: providerA({ hasStaffOrAdmin: true }) });
    expect(await offerIdentityLink(PHONE)).toEqual({ status: "SUPPORT_REQUIRED" });
    expect(sendOtpMock).not.toHaveBeenCalled();
  });

  it("NOT_APPLICABLE (unowned P) → no OTP", async () => {
    configure({ current: ordinaryB(), owner: null, ownerUserId: null });
    expect(await offerIdentityLink(PHONE)).toEqual({ status: "NOT_APPLICABLE" });
    expect(sendOtpMock).not.toHaveBeenCalled();
  });

  it("10. rate-limit / delivery failures from the OTP provider are surfaced, not bypassed", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    const apiError = Object.assign(new Error("x"), { body: { code: "TOO_MANY_REQUESTS" }, status: 429, statusCode: 429, headers: {}, name: "APIError" });
    sendOtpMock.mockRejectedValueOnce(apiError);
    expect(await offerIdentityLink(PHONE)).toEqual({ status: "RATE_LIMITED" });

    const delivery = Object.assign(new Error("x"), { body: { code: "OTP_DELIVERY_UNAVAILABLE" }, status: 503, statusCode: 503, headers: {}, name: "APIError" });
    sendOtpMock.mockRejectedValueOnce(delivery);
    expect(await offerIdentityLink(PHONE)).toEqual({ status: "OTP_DELIVERY_UNAVAILABLE" });
  });
});

// ── OTP VERIFY + TRANSACTION (§16.11-22, 28-31) ───────────────────────────────────────
describe("completeIdentityLink — provider link", () => {
  it("17/31. valid dual proof → verifies then invokes linkProviderCredential exactly once", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    const res = await completeIdentityLink(PHONE, "123456");
    expect(res).toEqual({ ok: true, outcome: "LINK_COMPLETED_REAUTH_REQUIRED" });
    expect(verifyPhoneMock).toHaveBeenCalledTimes(1);
    expect(linkProviderCredentialMock).toHaveBeenCalledTimes(1);
  });

  it("14/15/16. verify uses disableSession (no A session, no third AuthUser, no ownership move)", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    await completeIdentityLink(PHONE, "123456");
    const body = verifyPhoneMock.mock.calls[0]![0].body;
    expect(body).toEqual({ phoneNumber: PHONE, code: "123456", disableSession: true });
    expect(body.updatePhoneNumber).toBeUndefined();
  });

  it("18/19/20. identity is session-derived; client cannot select survivor/owner", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    await completeIdentityLink(PHONE, "123456");
    // The engine is called with the session user id (B), never a client value; the owner is
    // resolved server-side from the phone. The action signature accepts only (phone, code).
    expect(linkProviderCredentialMock).toHaveBeenCalledWith("B", PHONE);
  });

  it("11. invalid OTP → no transaction", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    verifyPhoneMock.mockRejectedValueOnce(Object.assign(new Error("x"), { body: { code: "INVALID_OTP" }, status: 400, statusCode: 400, headers: {}, name: "APIError" }));
    expect(await completeIdentityLink(PHONE, "000000")).toEqual({ ok: false, error: "INVALID_OTP" });
    expect(linkProviderCredentialMock).not.toHaveBeenCalled();
  });

  it("12. expired / replayed OTP (consumed → OTP_NOT_FOUND) → no transaction", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    verifyPhoneMock.mockRejectedValueOnce(Object.assign(new Error("x"), { body: { code: "OTP_EXPIRED" }, status: 400, statusCode: 400, headers: {}, name: "APIError" }));
    expect(await completeIdentityLink(PHONE, "123456")).toEqual({ ok: false, error: "INVALID_OTP" });
    verifyPhoneMock.mockRejectedValueOnce(Object.assign(new Error("x"), { body: { code: "OTP_NOT_FOUND" }, status: 400, statusCode: 400, headers: {}, name: "APIError" }));
    expect(await completeIdentityLink(PHONE, "123456")).toEqual({ ok: false, error: "INVALID_OTP" });
    expect(linkProviderCredentialMock).not.toHaveBeenCalled();
  });

  it("21/22. topology change (engine fails closed) → generic SUPPORT_REQUIRED", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    linkProviderCredentialMock.mockResolvedValueOnce({ ok: false, error: "NOT_PROVIDER_LINK_ELIGIBLE" });
    expect(await completeIdentityLink(PHONE, "123456")).toEqual({ ok: false, error: "SUPPORT_REQUIRED" });
    // OTP was consumed (proof happened) but the mutation failed closed.
    expect(verifyPhoneMock).toHaveBeenCalledTimes(1);
  });

  it("22. engine UNIQUE_RACE maps to generic SUPPORT_REQUIRED (no topology leak)", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    linkProviderCredentialMock.mockResolvedValueOnce({ ok: false, error: "UNIQUE_RACE" });
    expect(await completeIdentityLink(PHONE, "123456")).toEqual({ ok: false, error: "SUPPORT_REQUIRED" });
  });

  it("12b. per-IP verify rate limit is enforced before any verify/transaction", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    consumeRateLimitMock.mockResolvedValueOnce({ allowed: false });
    expect(await completeIdentityLink(PHONE, "123456")).toEqual({ ok: false, error: "RATE_LIMITED" });
    expect(verifyPhoneMock).not.toHaveBeenCalled();
    expect(linkProviderCredentialMock).not.toHaveBeenCalled();
  });

  it("13. proof-verified precedes the mutation; a failed proof emits no committed/verified success", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    verifyPhoneMock.mockRejectedValueOnce(Object.assign(new Error("x"), { body: { code: "INVALID_OTP" }, status: 400, statusCode: 400, headers: {}, name: "APIError" }));
    await completeIdentityLink(PHONE, "000000");
    const actions = auditCreateMock.mock.calls.map((c) => (c[0] as { action: string }).action);
    expect(actions).not.toContain("identity.link_proof_verified");
  });
});

// ── SESSION (§16.23-24) ────────────────────────────────────────────────────────────────
describe("completeIdentityLink — session after success", () => {
  it("23/24. provider success returns re-auth-required (B is not treated as A)", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    const res = await completeIdentityLink(PHONE, "123456");
    expect(res).toEqual({ ok: true, outcome: "LINK_COMPLETED_REAUTH_REQUIRED" });
  });
});

// ── CUSTOMER DELEGATION (unified entrypoint) ──────────────────────────────────────────
describe("completeIdentityLink — customer convergence delegation", () => {
  it("routes an eligible customer pair to the proven convergence action (not the provider engine)", async () => {
    configure({ current: ordinaryB(), owner: ordinaryOwnerC() });
    const res = await completeIdentityLink(PHONE, "123456");
    expect(res).toEqual({ ok: true, outcome: "CONVERGED" });
    expect(convergeMock).toHaveBeenCalledWith(PHONE, "123456");
    expect(linkProviderCredentialMock).not.toHaveBeenCalled();
    // The orchestration performs no OTP verify of its own for the customer branch — the
    // delegate owns the single OTP consumption.
    expect(verifyPhoneMock).not.toHaveBeenCalled();
  });

  it("maps a customer-convergence failure through without leaking", async () => {
    configure({ current: ordinaryB(), owner: ordinaryOwnerC() });
    convergeMock.mockResolvedValueOnce({ ok: false, error: "SUPPORT_REQUIRED" });
    expect(await completeIdentityLink(PHONE, "123456")).toEqual({ ok: false, error: "SUPPORT_REQUIRED" });
  });
});

// ── ENUMERATION (§16.25-27) ──────────────────────────────────────────────────────────
describe("anti-enumeration", () => {
  it("25. provider vs customer eligible public offer are indistinguishable", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    const p = await offerIdentityLink(PHONE);
    configure({ current: ordinaryB(), owner: ordinaryOwnerC() });
    const c = await offerIdentityLink(PHONE);
    expect(p).toEqual(c);
  });

  it("26/27. Staff/Admin/privileged stays generic; no role/reason/id in the public response", async () => {
    for (const owner of [providerA({ hasStaffOrAdmin: true }), providerA()]) {
      const current = owner.hasStaffOrAdmin ? ordinaryB() : ordinaryB({ hasProvider: true });
      configure({ current, owner });
      const res = await completeIdentityLink(PHONE, "123456");
      expect(res).toEqual({ ok: false, error: "SUPPORT_REQUIRED" });
      expect(JSON.stringify(res)).not.toMatch(/PROVIDER|STAFF|ADMIN|authA|custB|email|@/i);
    }
  });
});

// ── SIDE EFFECTS (§16.28-31) ──────────────────────────────────────────────────────────
describe("side effects", () => {
  it("28. assessment sends no OTP and never touches a mutation", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    await assessIdentityLink(PHONE);
    expect(sendOtpMock).not.toHaveBeenCalled();
    expect(verifyPhoneMock).not.toHaveBeenCalled();
    expect(linkProviderCredentialMock).not.toHaveBeenCalled();
    expect(convergeMock).not.toHaveBeenCalled();
  });

  it("29. offer sends the OTP but invokes no transaction", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    await offerIdentityLink(PHONE);
    expect(sendOtpMock).toHaveBeenCalledTimes(1);
    expect(linkProviderCredentialMock).not.toHaveBeenCalled();
    expect(convergeMock).not.toHaveBeenCalled();
  });

  it("30. an ineligible complete verifies nothing and runs no transaction", async () => {
    configure({ current: ordinaryB({ hasMeaningfulHistory: true }), owner: providerA() });
    expect(await completeIdentityLink(PHONE, "123456")).toEqual({ ok: false, error: "SUPPORT_REQUIRED" });
    expect(verifyPhoneMock).not.toHaveBeenCalled();
    expect(linkProviderCredentialMock).not.toHaveBeenCalled();
  });

  it("NOT_APPLICABLE complete → NOTHING_TO_LINK, no proof, no transaction", async () => {
    configure({ current: ordinaryB(), owner: null, ownerUserId: null });
    expect(await completeIdentityLink(PHONE, "123456")).toEqual({ ok: false, error: "NOTHING_TO_LINK" });
    expect(verifyPhoneMock).not.toHaveBeenCalled();
    expect(linkProviderCredentialMock).not.toHaveBeenCalled();
  });
});
