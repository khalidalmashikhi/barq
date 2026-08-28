import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IdentitySide } from "./identity-convergence-policy";

// AUTH-PROVIDER-LINK gate 3A.2 — orchestration tests over the BARQ-owned challenge model. The
// pure classifier runs for real; the proof module, the two terminal mutations, the SMS
// provider, Better Auth send, the loaders, the limiter and audit are mocked. These prove: the
// provider branch NEVER calls auth.api.verifyPhoneNumber; both eligible offers return an opaque
// attemptId (indistinguishable); the completion is bound to the session B + the server-bound P;
// owner substitution / unowned P / topology change fail closed; and SMS-send failure
// invalidates the challenge.

vi.mock("server-only", () => ({}));

class UnauthenticatedError extends Error {}
class ForbiddenError extends Error {}
const requireAuthMock = vi.fn();
vi.mock("./index", () => ({
  requireAuth: (...a: unknown[]) => requireAuthMock(...a),
  UnauthenticatedError,
  ForbiddenError,
}));

const sendPhoneOtpMock = vi.fn(); // Better Auth send (customer branch)
const verifyPhoneMock = vi.fn(); // Better Auth verify — MUST NEVER be called by the provider branch
vi.mock("./server", () => ({
  auth: { api: { sendPhoneNumberOTP: (...a: unknown[]) => sendPhoneOtpMock(...a), verifyPhoneNumber: (...a: unknown[]) => verifyPhoneMock(...a) } },
}));

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
vi.mock("./provider-credential-link", () => ({ linkProviderCredential: (...a: unknown[]) => linkProviderCredentialMock(...a) }));

const convergeMock = vi.fn();
vi.mock("./identity-convergence", () => ({ convergeCustomerIdentityByPhone: (...a: unknown[]) => convergeMock(...a) }));

// The BARQ-owned proof module — fully mocked so we test orchestration wiring.
const createProviderChallengeMock = vi.fn();
const createCustomerAttemptMock = vi.fn();
const loadAttemptMock = vi.fn();
const verifyProofMock = vi.fn();
const consumeCustomerMock = vi.fn();
const invalidateMock = vi.fn();
vi.mock("./identity-link-proof", () => ({
  createProviderLinkChallenge: (...a: unknown[]) => createProviderChallengeMock(...a),
  createCustomerLinkAttempt: (...a: unknown[]) => createCustomerAttemptMock(...a),
  loadLinkAttempt: (...a: unknown[]) => loadAttemptMock(...a),
  verifyAndConsumeProviderProof: (...a: unknown[]) => verifyProofMock(...a),
  consumeCustomerLinkAttempt: (...a: unknown[]) => consumeCustomerMock(...a),
  invalidateLinkAttempt: (...a: unknown[]) => invalidateMock(...a),
}));

const sendSmsMock = vi.fn();
vi.mock("@/lib/otp/get-otp-provider", () => ({ getOtpProvider: () => ({ name: "test", send: (...a: unknown[]) => sendSmsMock(...a) }) }));
vi.mock("@/lib/otp/otp-config", () => ({
  getOtpConfig: () => ({ expiresInSeconds: 300, maxAttempts: 3, resendCooldownSeconds: 30, maxSendsPerDay: 10 }),
}));

vi.mock("@/lib/phone/normalize-international-phone", () => ({
  normalizeInternationalPhone: (input: string) =>
    typeof input === "string" && input.startsWith("+") ? { ok: true, e164: input } : { ok: false, reason: "INVALID_NUMBER" },
}));

const consumeRateLimitMock = vi.fn();
vi.mock("@/lib/rate-limit/durable-rate-limiter", () => ({ consumeRateLimit: (...a: unknown[]) => consumeRateLimitMock(...a) }));
vi.mock("@/lib/rate-limit/client-ip", () => ({ resolveClientIp: () => "1.2.3.4", hmacRateLimitKey: (v: string) => `hmac(${v})` }));
vi.mock("@/lib/otp/otp-rate-limit-config", () => ({
  getOtpSendIpRateLimit: () => ({ limit: 15, windowSeconds: 3600 }),
  getOtpSendPhoneRateLimit: () => ({ limit: 6, windowSeconds: 3600 }),
  getOtpVerifyIpRateLimit: () => ({ limit: 30, windowSeconds: 3600 }),
  otpSendIpKey: (k: string) => `si:${k}`,
  otpSendPhoneKey: (k: string) => `sp:${k}`,
  otpVerifyIpKey: (k: string) => `v:${k}`,
}));
vi.mock("@/lib/otp/audit", () => ({ maskPhoneNumber: (p: string) => `***${p.slice(-4)}` }));
const loggerWarnMock = vi.fn();
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: (...a: unknown[]) => loggerWarnMock(...a), error: vi.fn() } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
const auditCreateMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: (params: unknown) => auditCreateMock(params) }));
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
function ordinaryB(over: Partial<IdentitySide> = {}): IdentitySide {
  return side({ userId: "B", authUserId: "authB", authEmail: "b@example.com", authEmailVerified: true, hasCustomer: true, customerId: "custB", ...over });
}
function providerA(over: Partial<IdentitySide> = {}): IdentitySide {
  return side({
    userId: "A", authUserId: "authA", authEmail: `${PHONE}@phone.barq.internal`, authEmailVerified: true,
    authPhone: PHONE, authPhoneVerified: true, userPhone: PHONE, hasProvider: true, createdAt: new Date("2023-01-01T00:00:00Z"), ...over,
  });
}
function ordinaryOwnerC(over: Partial<IdentitySide> = {}): IdentitySide {
  return side({ userId: "C", authUserId: "authC", authPhone: PHONE, authPhoneVerified: true, userPhone: PHONE, hasCustomer: true, customerId: "custC", createdAt: new Date("2022-01-01T00:00:00Z"), ...over });
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
  sendPhoneOtpMock.mockResolvedValue({});
  sendSmsMock.mockResolvedValue(undefined);
  createProviderChallengeMock.mockResolvedValue({ challengeId: "C".repeat(64), code: "123456" });
  createCustomerAttemptMock.mockResolvedValue({ challengeId: "D".repeat(64) });
  verifyProofMock.mockResolvedValue({ ok: true });
  linkProviderCredentialMock.mockResolvedValue({ ok: true, survivorUserId: "A" });
  convergeMock.mockResolvedValue({ ok: true });
});

const providerLoaded = { ok: true, purpose: "PROVIDER_CREDENTIAL_LINK", phone: PHONE, ownerAuthUserId: "authA", otpHash: "hash" };
const customerLoaded = { ok: true, purpose: "CUSTOMER_CONVERGENCE", phone: PHONE };

// ── ASSESSMENT ────────────────────────────────────────────────────────────────────────
describe("assessIdentityLink", () => {
  it("provider and customer eligible are both LINK_AVAILABLE and byte-identical", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    const p = await assessIdentityLink(PHONE);
    configure({ current: ordinaryB(), owner: ordinaryOwnerC() });
    const c = await assessIdentityLink(PHONE);
    expect(p).toEqual({ status: "LINK_AVAILABLE" });
    expect(p).toEqual(c);
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(createProviderChallengeMock).not.toHaveBeenCalled();
  });

  it("Staff owner blocked; current-privileged blocked (generic SUPPORT_REQUIRED, no leak)", async () => {
    configure({ current: ordinaryB(), owner: providerA({ hasStaffOrAdmin: true }) });
    expect(await assessIdentityLink(PHONE)).toEqual({ status: "SUPPORT_REQUIRED" });
    configure({ current: ordinaryB({ hasProvider: true }), owner: providerA() });
    expect(await assessIdentityLink(PHONE)).toEqual({ status: "SUPPORT_REQUIRED" });
  });

  it("NOT_APPLICABLE when P unowned; NOT_AUTHENTICATED unsigned; INVALID_PHONE", async () => {
    configure({ current: ordinaryB(), owner: null, ownerUserId: null });
    expect(await assessIdentityLink(PHONE)).toEqual({ status: "NOT_APPLICABLE" });
    requireAuthMock.mockRejectedValueOnce(new UnauthenticatedError());
    expect(await assessIdentityLink(PHONE)).toEqual({ status: "NOT_AUTHENTICATED" });
    configure({ current: ordinaryB(), owner: providerA() });
    expect(await assessIdentityLink("bad")).toEqual({ status: "INVALID_PHONE" });
  });
});

// ── OFFER (BARQ challenge, anti-enumeration, send failure) ─────────────────────────────
describe("offerIdentityLink", () => {
  it("provider consent → BARQ challenge + SMS via the OTP provider; returns opaque attemptId", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    const res = await offerIdentityLink(PHONE);
    expect(res).toEqual({ status: "OWNERSHIP_VERIFICATION_REQUIRED", attemptId: "C".repeat(64) });
    expect(createProviderChallengeMock).toHaveBeenCalledWith({ currentUserId: "B", phone: PHONE, ownerAuthUserId: "authA" });
    expect(sendSmsMock).toHaveBeenCalledWith({ phoneNumber: PHONE, code: "123456" });
    expect(sendPhoneOtpMock).not.toHaveBeenCalled(); // NOT Better Auth send for provider
    expect(verifyPhoneMock).not.toHaveBeenCalled();
  });

  it("customer consent → Better Auth send + opaque attemptId; provider/customer responses indistinguishable in shape", async () => {
    configure({ current: ordinaryB(), owner: ordinaryOwnerC() });
    const cust = await offerIdentityLink(PHONE);
    expect(cust).toEqual({ status: "OWNERSHIP_VERIFICATION_REQUIRED", attemptId: "D".repeat(64) });
    expect(sendPhoneOtpMock).toHaveBeenCalledTimes(1);
    // Both eligible offers: same status key + an attemptId string (account type not enumerable).
    configure({ current: ordinaryB(), owner: providerA() });
    const prov = await offerIdentityLink(PHONE);
    expect(Object.keys(prov).sort()).toEqual(Object.keys(cust).sort());
    expect(typeof (prov as { attemptId: string }).attemptId).toBe("string");
  });

  it("blocked pair (Staff) → no challenge, no SMS", async () => {
    configure({ current: ordinaryB(), owner: providerA({ hasStaffOrAdmin: true }) });
    expect(await offerIdentityLink(PHONE)).toEqual({ status: "SUPPORT_REQUIRED" });
    expect(createProviderChallengeMock).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it("provider send-side rate limit → RATE_LIMITED, no challenge, no SMS", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    consumeRateLimitMock.mockResolvedValueOnce({ allowed: false }); // cooldown denies first
    expect(await offerIdentityLink(PHONE)).toEqual({ status: "RATE_LIMITED" });
    expect(createProviderChallengeMock).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it("SMS delivery failure invalidates the challenge (no dangling usable proof)", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    sendSmsMock.mockRejectedValueOnce(new Error("twilio down"));
    expect(await offerIdentityLink(PHONE)).toEqual({ status: "OTP_DELIVERY_UNAVAILABLE" });
    expect(invalidateMock).toHaveBeenCalledWith("C".repeat(64));
  });

  it("NOT_APPLICABLE (unowned P) → no challenge, no SMS", async () => {
    configure({ current: ordinaryB(), owner: null, ownerUserId: null });
    expect(await offerIdentityLink(PHONE)).toEqual({ status: "NOT_APPLICABLE" });
    expect(createProviderChallengeMock).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
  });
});

// ── COMPLETE — provider branch (no verifyPhoneNumber, bound proof) ─────────────────────
describe("completeIdentityLink — provider", () => {
  it("valid bound proof → verify BARQ challenge (never Better Auth) then link exactly once", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    loadAttemptMock.mockResolvedValue(providerLoaded);
    const res = await completeIdentityLink("C".repeat(64), "123456");
    expect(res).toEqual({ ok: true, outcome: "LINK_COMPLETED_REAUTH_REQUIRED" });
    expect(verifyProofMock).toHaveBeenCalledWith({ challengeId: "C".repeat(64), code: "123456", otpHash: "hash" });
    expect(verifyPhoneMock).not.toHaveBeenCalled(); // structural: never Better Auth verify
    expect(linkProviderCredentialMock).toHaveBeenCalledTimes(1);
    expect(linkProviderCredentialMock).toHaveBeenCalledWith("B", PHONE); // B from session, P server-bound
  });

  it("wrong / exhausted OTP → INVALID_OTP, no link", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    loadAttemptMock.mockResolvedValue(providerLoaded);
    verifyProofMock.mockResolvedValueOnce({ ok: false, reason: "INVALID_OTP" });
    expect(await completeIdentityLink("C".repeat(64), "000000")).toEqual({ ok: false, error: "INVALID_OTP" });
    verifyProofMock.mockResolvedValueOnce({ ok: false, reason: "TOO_MANY_ATTEMPTS" });
    expect(await completeIdentityLink("C".repeat(64), "000000")).toEqual({ ok: false, error: "INVALID_OTP" });
    expect(linkProviderCredentialMock).not.toHaveBeenCalled();
  });

  it("verify-IP rate limit → RATE_LIMITED before any proof/link", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    loadAttemptMock.mockResolvedValue(providerLoaded);
    consumeRateLimitMock.mockResolvedValueOnce({ allowed: false });
    expect(await completeIdentityLink("C".repeat(64), "123456")).toEqual({ ok: false, error: "RATE_LIMITED" });
    expect(verifyProofMock).not.toHaveBeenCalled();
    expect(linkProviderCredentialMock).not.toHaveBeenCalled();
  });

  it("owner substitution A→C after proof → fail closed, no link (proof already consumed)", async () => {
    // Challenge bound to owner authA, but P is now owned by C (authC).
    configure({ current: ordinaryB(), owner: providerA({ userId: "C", authUserId: "authC" }) });
    loadAttemptMock.mockResolvedValue(providerLoaded); // ownerAuthUserId: authA
    expect(await completeIdentityLink("C".repeat(64), "123456")).toEqual({ ok: false, error: "SUPPORT_REQUIRED" });
    expect(verifyProofMock).toHaveBeenCalledTimes(1); // OTP was consumed
    expect(linkProviderCredentialMock).not.toHaveBeenCalled();
  });

  it("P unowned at completion → fail closed, no link", async () => {
    configure({ current: ordinaryB(), owner: null, ownerUserId: null });
    loadAttemptMock.mockResolvedValue(providerLoaded);
    expect(await completeIdentityLink("C".repeat(64), "123456")).toEqual({ ok: false, error: "SUPPORT_REQUIRED" });
    expect(linkProviderCredentialMock).not.toHaveBeenCalled();
  });

  it("no longer classifiable as provider link → fail closed, no link", async () => {
    configure({ current: ordinaryB({ hasMeaningfulHistory: true }), owner: providerA() });
    loadAttemptMock.mockResolvedValue(providerLoaded);
    expect(await completeIdentityLink("C".repeat(64), "123456")).toEqual({ ok: false, error: "SUPPORT_REQUIRED" });
    expect(linkProviderCredentialMock).not.toHaveBeenCalled();
  });

  it("engine fail-closed maps to generic SUPPORT_REQUIRED (no topology leak)", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    loadAttemptMock.mockResolvedValue(providerLoaded);
    linkProviderCredentialMock.mockResolvedValueOnce({ ok: false, error: "NOT_PROVIDER_LINK_ELIGIBLE" });
    const res = await completeIdentityLink("C".repeat(64), "123456");
    expect(res).toEqual({ ok: false, error: "SUPPORT_REQUIRED" });
    expect(JSON.stringify(res)).not.toMatch(/PROVIDER|STAFF|ADMIN|authA/i);
  });

  it("unknown / not-yours / expired challenge → INVALID_CHALLENGE, no proof, no link", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    for (const reason of ["NOT_FOUND", "WRONG_B", "EXPIRED"]) {
      loadAttemptMock.mockResolvedValueOnce({ ok: false, reason });
      expect(await completeIdentityLink("C".repeat(64), "123456")).toEqual({ ok: false, error: "INVALID_CHALLENGE" });
    }
    expect(verifyProofMock).not.toHaveBeenCalled();
    expect(linkProviderCredentialMock).not.toHaveBeenCalled();
  });
});

// ── COMPLETE — customer delegation ─────────────────────────────────────────────────────
describe("completeIdentityLink — customer", () => {
  it("routes to the unchanged convergence action; consumes the attempt on success", async () => {
    configure({ current: ordinaryB(), owner: ordinaryOwnerC() });
    loadAttemptMock.mockResolvedValue(customerLoaded);
    const res = await completeIdentityLink("D".repeat(64), "123456");
    expect(res).toEqual({ ok: true, outcome: "CONVERGED" });
    expect(convergeMock).toHaveBeenCalledWith(PHONE, "123456");
    expect(consumeCustomerMock).toHaveBeenCalledWith("D".repeat(64));
    expect(verifyProofMock).not.toHaveBeenCalled();
    expect(linkProviderCredentialMock).not.toHaveBeenCalled();
  });

  it("maps a convergence failure through without leaking; does not consume the attempt", async () => {
    configure({ current: ordinaryB(), owner: ordinaryOwnerC() });
    loadAttemptMock.mockResolvedValue(customerLoaded);
    convergeMock.mockResolvedValueOnce({ ok: false, error: "INVALID_OTP" });
    expect(await completeIdentityLink("D".repeat(64), "123456")).toEqual({ ok: false, error: "INVALID_OTP" });
    expect(consumeCustomerMock).not.toHaveBeenCalled();
  });
});

// ── SIDE EFFECTS / STRUCTURAL ──────────────────────────────────────────────────────────
describe("structural guarantees", () => {
  it("assessment sends no SMS, creates no challenge, verifies no proof, invokes no mutation", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    await assessIdentityLink(PHONE);
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(sendPhoneOtpMock).not.toHaveBeenCalled();
    expect(createProviderChallengeMock).not.toHaveBeenCalled();
    expect(verifyProofMock).not.toHaveBeenCalled();
    expect(linkProviderCredentialMock).not.toHaveBeenCalled();
    expect(convergeMock).not.toHaveBeenCalled();
  });

  it("the provider branch never calls Better Auth verifyPhoneNumber in any path", async () => {
    configure({ current: ordinaryB(), owner: providerA() });
    loadAttemptMock.mockResolvedValue(providerLoaded);
    await completeIdentityLink("C".repeat(64), "123456");
    verifyProofMock.mockResolvedValueOnce({ ok: false, reason: "INVALID_OTP" });
    await completeIdentityLink("C".repeat(64), "000000");
    expect(verifyPhoneMock).not.toHaveBeenCalled();
  });
});
