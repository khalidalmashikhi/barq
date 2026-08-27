import { describe, it, expect, vi, beforeEach } from "vitest";

// AUTH-IDENTITY-CONVERGENCE-1 — server-action tests for the dual-proof convergence.
// Better Auth (send/verify) + prisma are mocked; the pure policy is exercised for
// real (identity-convergence-policy). These prove: conflict never silently transfers
// a credential, ownership OTP is required, privileged/dual-history cases block, the
// simple case converges (credential transferred, loser retained+deactivated, sessions
// invalidated, relations re-parented), the tx re-asserts + fails closed, and no PII
// leaks in any returned state.

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

// Real synthetic-email detection (pure), no server imports pulled in.
vi.mock("./linked-email", () => ({
  isSyntheticAuthEmail: (e: string | null | undefined) => typeof e === "string" && e.toLowerCase().endsWith("@phone.barq.internal"),
}));

const consumeRateLimitMock = vi.fn();
vi.mock("@/lib/rate-limit/durable-rate-limiter", () => ({ consumeRateLimit: (...a: unknown[]) => consumeRateLimitMock(...a) }));
vi.mock("@/lib/rate-limit/client-ip", () => ({ resolveClientIp: () => "1.2.3.4", hmacRateLimitKey: (v: string) => `hmac(${v})` }));
vi.mock("@/lib/otp/otp-rate-limit-config", () => ({
  getOtpVerifyIpRateLimit: () => ({ limit: 30, windowSeconds: 3600 }),
  otpVerifyIpKey: (k: string) => `v:${k}`,
}));
vi.mock("@/lib/otp/audit", () => ({ maskPhoneNumber: (p: string) => `***${p.slice(-4)}` }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const auditCreateMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({
  recordAuditEvent: (params: unknown, db: { auditLog: { create: (x: unknown) => unknown } }) => db.auditLog.create({ data: params }),
}));

// ---- prisma mock: a small in-memory identity store ------------------------------
type Rec = {
  id: string;
  authUserId: string;
  status: string;
  createdAt: Date;
  phoneNumber: string | null;
  authEmail: string | null;
  authEmailVerified: boolean;
  authPhone: string | null;
  authPhoneVerified: boolean;
  privilege?: boolean;
  hasCustomer?: boolean;
  customerId?: string | null;
  history?: boolean;
};

let store: Record<string, Rec> = {};
const authUserUpdate = vi.fn();
const userUpdate = vi.fn();
const userUpdateMany = vi.fn();
const accountUpdateMany = vi.fn();
const notifUpdateMany = vi.fn();
const sessionDeleteMany = vi.fn();
const auditLog = { create: (x: unknown) => auditCreateMock(x) };

function makeUserFindUnique() {
  return vi.fn(async (args: { where: { id?: string; phoneNumber?: string }; select?: unknown; include?: unknown }) => {
    if (args.where.phoneNumber && args.select) {
      const r = Object.values(store).find((x) => x.phoneNumber === args.where.phoneNumber);
      return r ? { id: r.id } : null;
    }
    const r = args.where.id ? store[args.where.id] : undefined;
    if (!r) return null;
    return {
      id: r.id,
      phoneNumber: r.phoneNumber,
      status: r.status,
      createdAt: r.createdAt,
      authUser: {
        id: r.authUserId,
        email: r.authEmail,
        emailVerified: r.authEmailVerified,
        phoneNumber: r.authPhone,
        phoneNumberVerified: r.authPhoneVerified,
      },
      providerLink: r.privilege ? { id: "p" } : null,
      staff: null,
      admin: null,
      customer:
        r.hasCustomer === false
          ? null
          : { id: r.customerId ?? `c-${r.id}`, wallet: r.history ? { id: "w" } : null, _count: { bookings: r.history ? 1 : 0, reviews: 0, contracts: 0, supportTickets: 0 } },
    };
  });
}

function makeAuthUserFindUnique() {
  return vi.fn(async (args: { where: { phoneNumber: string }; select?: unknown }) => {
    const r = Object.values(store).find((x) => x.authPhone === args.where.phoneNumber);
    return r ? { barqUser: { id: r.id } } : null;
  });
}

const tx = {
  authUser: { findUnique: makeAuthUserFindUnique(), update: authUserUpdate },
  user: { findUnique: makeUserFindUnique(), update: userUpdate, updateMany: userUpdateMany },
  account: { updateMany: accountUpdateMany },
  notification: { updateMany: notifUpdateMany },
  session: { deleteMany: sessionDeleteMany },
  auditLog,
};

const txThrows = { willThrowP2002: false };

vi.mock("@/lib/db", () => ({
  prisma: {
    authUser: { findUnique: (...a: unknown[]) => tx.authUser.findUnique(...(a as [never])), update: authUserUpdate },
    user: { findUnique: (...a: unknown[]) => tx.user.findUnique(...(a as [never])), update: userUpdate, updateMany: userUpdateMany },
    account: { updateMany: accountUpdateMany },
    notification: { updateMany: notifUpdateMany },
    session: { deleteMany: sessionDeleteMany },
    auditLog,
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
      const r = await fn(tx);
      if (txThrows.willThrowP2002) {
        const { Prisma } = await import("@prisma/client");
        throw new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "x" });
      }
      return r;
    },
  },
}));

const { assessIdentityConvergence, offerIdentityConvergence, convergeCustomerIdentityByPhone } = await import(
  "./identity-convergence"
);

const PHONE = "+96891112222";

function setStore(recs: Rec[]) {
  store = {};
  for (const r of recs) store[r.id] = r;
}

const B: Rec = {
  id: "B",
  authUserId: "aB",
  status: "ACTIVE",
  createdAt: new Date("2026-06-01T00:00:00Z"),
  phoneNumber: null,
  authEmail: "cust@example.com",
  authEmailVerified: true,
  authPhone: null,
  authPhoneVerified: false,
  hasCustomer: true,
};
const A: Rec = {
  id: "A",
  authUserId: "aA",
  status: "ACTIVE",
  createdAt: new Date("2025-01-01T00:00:00Z"),
  phoneNumber: PHONE,
  authEmail: "111@phone.barq.internal",
  authEmailVerified: false,
  authPhone: PHONE,
  authPhoneVerified: true,
  hasCustomer: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ authUserId: "aB", barqUser: { id: "B", phoneNumber: null } });
  consumeRateLimitMock.mockResolvedValue({ allowed: true });
  sendOtpMock.mockResolvedValue({});
  verifyPhoneMock.mockResolvedValue({ status: true });
  txThrows.willThrowP2002 = false;
  setStore([{ ...B }, { ...A }]);
});

describe("assessIdentityConvergence — read-only, NO OTP, NO mutation (three-choice gate)", () => {
  it("eligible conflict → CONVERGENCE_AVAILABLE, sends no OTP and mutates nothing", async () => {
    const res = await assessIdentityConvergence(PHONE);
    expect(res).toEqual({ status: "CONVERGENCE_AVAILABLE" });
    expect(sendOtpMock).not.toHaveBeenCalled();
    expect(authUserUpdate).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(sessionDeleteMany).not.toHaveBeenCalled();
    expect(auditCreateMock).not.toHaveBeenCalled();
  });

  it("owned by another but privileged → generic SUPPORT_REQUIRED, still no OTP/mutation, no PII", async () => {
    setStore([{ ...B }, { ...A, privilege: true }]);
    const res = await assessIdentityConvergence(PHONE);
    expect(res).toEqual({ status: "SUPPORT_REQUIRED" });
    expect(sendOtpMock).not.toHaveBeenCalled();
    expect(JSON.stringify(res)).not.toContain("example.com");
    expect(JSON.stringify(res)).not.toContain(PHONE);
  });

  it("a phone not owned by another identity → NOT_APPLICABLE (normal Add-phone flow)", async () => {
    setStore([{ ...B }]); // nobody owns PHONE
    expect(await assessIdentityConvergence(PHONE)).toEqual({ status: "NOT_APPLICABLE" });
    expect(sendOtpMock).not.toHaveBeenCalled();
  });

  it("unauthenticated → NOT_AUTHENTICATED", async () => {
    requireAuthMock.mockRejectedValue(new UnauthenticatedError());
    expect(await assessIdentityConvergence(PHONE)).toEqual({ status: "NOT_AUTHENTICATED" });
    expect(sendOtpMock).not.toHaveBeenCalled();
  });

  it("a SECOND conflicting phone re-enters the convergence-choice state (CONVERGENCE_AVAILABLE again)", async () => {
    const SECOND = "+96895556666";
    setStore([
      { ...B },
      { ...A },
      { ...A, id: "A2", authUserId: "aA2", phoneNumber: SECOND, authPhone: SECOND },
    ]);
    expect(await assessIdentityConvergence(SECOND)).toEqual({ status: "CONVERGENCE_AVAILABLE" });
    expect(sendOtpMock).not.toHaveBeenCalled();
  });
});

describe("offerIdentityConvergence", () => {
  it("NOT_AUTHENTICATED when there is no session", async () => {
    requireAuthMock.mockRejectedValue(new UnauthenticatedError());
    expect(await offerIdentityConvergence(PHONE)).toEqual({ status: "NOT_AUTHENTICATED" });
    expect(sendOtpMock).not.toHaveBeenCalled();
  });

  it("NOT_APPLICABLE when the phone is not owned by another identity", async () => {
    setStore([{ ...B }]); // A absent → nobody owns PHONE
    expect(await offerIdentityConvergence(PHONE)).toEqual({ status: "NOT_APPLICABLE" });
    expect(sendOtpMock).not.toHaveBeenCalled();
  });

  it("eligible → sends the proof OTP and returns OWNERSHIP_VERIFICATION_REQUIRED with no PII", async () => {
    const res = await offerIdentityConvergence(PHONE);
    expect(res).toEqual({ status: "OWNERSHIP_VERIFICATION_REQUIRED" });
    expect(sendOtpMock).toHaveBeenCalledWith(expect.objectContaining({ body: { phoneNumber: PHONE } }));
    // No PII of the other identity: neither its email nor its phone appears in the state.
    expect(JSON.stringify(res)).not.toContain("example.com");
    expect(JSON.stringify(res)).not.toContain(PHONE);
  });

  it("SUPPORT_REQUIRED (no OTP) when the phone owner has a privileged profile", async () => {
    setStore([{ ...B }, { ...A, privilege: true }]);
    expect(await offerIdentityConvergence(PHONE)).toEqual({ status: "SUPPORT_REQUIRED" });
    expect(sendOtpMock).not.toHaveBeenCalled();
  });

  it("SUPPORT_REQUIRED when both identities hold meaningful history", async () => {
    setStore([{ ...B, history: true }, { ...A, history: true }]);
    expect(await offerIdentityConvergence(PHONE)).toEqual({ status: "SUPPORT_REQUIRED" });
    expect(sendOtpMock).not.toHaveBeenCalled();
  });
});

describe("convergeCustomerIdentityByPhone", () => {
  it("NOT_AUTHENTICATED with no session; never verifies an OTP", async () => {
    requireAuthMock.mockRejectedValue(new UnauthenticatedError());
    expect(await convergeCustomerIdentityByPhone(PHONE, "123456")).toEqual({ ok: false, error: "NOT_AUTHENTICATED" });
    expect(verifyPhoneMock).not.toHaveBeenCalled();
  });

  it("requires a non-empty OTP", async () => {
    expect(await convergeCustomerIdentityByPhone(PHONE, "  ")).toEqual({ ok: false, error: "INVALID_OTP" });
    expect(verifyPhoneMock).not.toHaveBeenCalled();
  });

  it("RATE_LIMITED before verifying when the verify cap is exceeded", async () => {
    consumeRateLimitMock.mockResolvedValueOnce({ allowed: false });
    expect(await convergeCustomerIdentityByPhone(PHONE, "123456")).toEqual({ ok: false, error: "RATE_LIMITED" });
    expect(verifyPhoneMock).not.toHaveBeenCalled();
  });

  it("wrong OTP → INVALID_OTP and NO mutation (no silent transfer)", async () => {
    const { APIError } = await import("better-auth/api");
    verifyPhoneMock.mockRejectedValue(new APIError("BAD_REQUEST", { code: "INVALID_OTP", message: "x" }));
    expect(await convergeCustomerIdentityByPhone(PHONE, "000000")).toEqual({ ok: false, error: "INVALID_OTP" });
    expect(authUserUpdate).not.toHaveBeenCalled();
    expect(sessionDeleteMany).not.toHaveBeenCalled();
  });

  it("verifies P with disableSession:true (never signs in as the owner)", async () => {
    await convergeCustomerIdentityByPhone(PHONE, "123456");
    expect(verifyPhoneMock).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ phoneNumber: PHONE, code: "123456", disableSession: true }) })
    );
    // never the updatePhoneNumber (attach-to-me) branch
    expect(verifyPhoneMock.mock.calls[0]![0].body).not.toHaveProperty("updatePhoneNumber");
  });

  it("simple case (B email-first survivor by history) → phone transferred, A retained+deactivated, sessions killed", async () => {
    // B has history (survivor), A is the phone-only loser.
    setStore([{ ...B, history: true }, { ...A }]);
    const res = await convergeCustomerIdentityByPhone(PHONE, "123456");
    expect(res).toEqual({ ok: true });
    // phone released from loser A first, then claimed by survivor B
    expect(authUserUpdate).toHaveBeenCalledWith({ where: { id: "aA" }, data: { phoneNumber: null, phoneNumberVerified: false } });
    expect(authUserUpdate).toHaveBeenCalledWith({ where: { id: "aB" }, data: { phoneNumber: PHONE, phoneNumberVerified: true } });
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: "B" }, data: { phoneNumber: PHONE, phoneNumberVerified: true } });
    // loser retained (DEACTIVATED, not deleted) + sessions invalidated + relations re-parented
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: "A" }, data: { status: "DEACTIVATED" } });
    expect(sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: "aA" } });
    expect(accountUpdateMany).toHaveBeenCalledWith({ where: { userId: "aA" }, data: { userId: "aB" } });
    expect(notifUpdateMany).toHaveBeenCalledWith({ where: { userId: "A" }, data: { userId: "B" } });
    // audit
    expect(auditCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "identity.convergence_completed" }) })
    );
  });

  it("survivor = A (phone-first, older, has history) → real email transferred from B onto A", async () => {
    setStore([{ ...B }, { ...A, history: true }]);
    const res = await convergeCustomerIdentityByPhone(PHONE, "123456");
    expect(res).toEqual({ ok: true });
    // email released from loser B, then set on survivor A
    expect(authUserUpdate).toHaveBeenCalledWith({ where: { id: "aB" }, data: { email: null, emailVerified: false } });
    expect(authUserUpdate).toHaveBeenCalledWith({ where: { id: "aA" }, data: { email: "cust@example.com", emailVerified: true } });
    // loser is B this time
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: "B" }, data: { status: "DEACTIVATED" } });
    expect(sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: "aB" } });
  });

  it("blocks (SUPPORT_REQUIRED) if a privileged profile appears by the time the tx re-checks", async () => {
    // Owner becomes privileged after the OTP proof but before/within the tx re-read.
    setStore([{ ...B, history: true }, { ...A, privilege: true }]);
    const res = await convergeCustomerIdentityByPhone(PHONE, "123456");
    expect(res).toEqual({ ok: false, error: "SUPPORT_REQUIRED" });
    // nothing mutated
    expect(userUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ data: { status: "DEACTIVATED" } }));
    expect(sessionDeleteMany).not.toHaveBeenCalled();
  });

  it("a unique-constraint race in the transaction fails closed to SUPPORT_REQUIRED", async () => {
    setStore([{ ...B, history: true }, { ...A }]);
    txThrows.willThrowP2002 = true;
    expect(await convergeCustomerIdentityByPhone(PHONE, "123456")).toEqual({ ok: false, error: "SUPPORT_REQUIRED" });
  });

  it("returns no PII in the blocked/support result", async () => {
    setStore([{ ...B }, { ...A, privilege: true }]);
    const res = await convergeCustomerIdentityByPhone(PHONE, "123456");
    expect(JSON.stringify(res)).not.toContain("example.com");
    expect(JSON.stringify(res)).not.toContain(PHONE);
  });
});
