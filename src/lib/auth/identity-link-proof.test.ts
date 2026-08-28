import { describe, it, expect, vi, beforeEach } from "vitest";

// AUTH-PROVIDER-LINK gate 3A.2 — tests for the BARQ-owned, purpose/B/P/attempt-bound phone
// proof. Real crypto (HMAC round-trip) runs; the Verification table and the durable rate
// limiter are backed by small in-memory fakes. These prove: purpose/B binding, expiry,
// bounded attempts, atomic single-use consumption, no-plaintext-OTP-at-rest, and that the
// namespaced identifier is isolated from Better Auth's bare-phone rows.

vi.mock("server-only", () => ({}));

// ── in-memory Verification store ─────────────────────────────────────────────────────
type Row = { id: string; identifier: string; value: string; expiresAt: Date; createdAt: Date; updatedAt: Date };
let store: Map<string, Row>;

const verification = {
  create: vi.fn(async ({ data }: { data: Omit<Row, "createdAt" | "updatedAt"> }) => {
    const row: Row = { ...data, createdAt: new Date(), updatedAt: new Date() };
    store.set(data.id, row);
    return row;
  }),
  findUnique: vi.fn(async ({ where }: { where: { id: string } }) => store.get(where.id) ?? null),
  deleteMany: vi.fn(async ({ where }: { where: { id: string; identifier?: string } }) => {
    const row = store.get(where.id);
    if (row && (where.identifier === undefined || row.identifier === where.identifier)) {
      store.delete(where.id);
      return { count: 1 };
    }
    return { count: 0 };
  }),
};
vi.mock("@/lib/db", () => ({ prisma: { verification } }));

// Durable limiter fake — configurable allow/deny.
const consumeRateLimitMock = vi.fn();
vi.mock("@/lib/rate-limit/durable-rate-limiter", () => ({ consumeRateLimit: (...a: unknown[]) => consumeRateLimitMock(...a) }));

// getOtpConfig — real would read env; pin it deterministically.
vi.mock("@/lib/otp/otp-config", () => ({
  getOtpConfig: () => ({ expiresInSeconds: 300, maxAttempts: 3, resendCooldownSeconds: 30, maxSendsPerDay: 10 }),
}));

const {
  generateNumericOtp,
  createProviderLinkChallenge,
  createCustomerLinkAttempt,
  loadLinkAttempt,
  verifyAndConsumeProviderProof,
  invalidateLinkAttempt,
  consumeCustomerLinkAttempt,
} = await import("./identity-link-proof");

const B = "user-B";
const A_AUTH = "authUser-A";
const PHONE = "+96892123456";

beforeEach(() => {
  vi.clearAllMocks();
  store = new Map();
  consumeRateLimitMock.mockResolvedValue({ allowed: true });
  process.env.BETTER_AUTH_SECRET = "test-secret-abc";
});

describe("generateNumericOtp", () => {
  it("produces digit-only codes of the requested length", () => {
    for (let i = 0; i < 50; i++) {
      const otp = generateNumericOtp(6);
      expect(otp).toMatch(/^[0-9]{6}$/);
    }
    expect(generateNumericOtp(4)).toMatch(/^[0-9]{4}$/);
  });
});

describe("createProviderLinkChallenge", () => {
  it("persists a namespaced row binding purpose/B/P/owner, stores the OTP only as a hash, returns id+code", async () => {
    const { challengeId, code } = await createProviderLinkChallenge({ currentUserId: B, phone: PHONE, ownerAuthUserId: A_AUTH });
    expect(challengeId).toMatch(/^[0-9a-f]{64}$/);
    expect(code).toMatch(/^[0-9]{6}$/);
    const row = store.get(challengeId)!;
    expect(row.identifier).toBe(`identity-link:${challengeId}`); // namespaced away from bare phone
    const payload = JSON.parse(row.value);
    expect(payload).toMatchObject({ v: 1, purpose: "PROVIDER_CREDENTIAL_LINK", currentUserId: B, phone: PHONE, ownerAuthUserId: A_AUTH });
    expect(payload.otpHash).toMatch(/^[0-9a-f]{64}$/);
    // The plaintext OTP is NEVER stored.
    expect(row.value).not.toContain(code);
    expect(payload).not.toHaveProperty("code");
    expect(payload).not.toHaveProperty("otp");
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("loadLinkAttempt", () => {
  it("loads a valid provider challenge bound to B (no consume)", async () => {
    const { challengeId } = await createProviderLinkChallenge({ currentUserId: B, phone: PHONE, ownerAuthUserId: A_AUTH });
    const loaded = await loadLinkAttempt(challengeId, B);
    expect(loaded).toMatchObject({ ok: true, purpose: "PROVIDER_CREDENTIAL_LINK", phone: PHONE, ownerAuthUserId: A_AUTH });
    expect(store.has(challengeId)).toBe(true); // not consumed
  });

  it("rejects a challenge minted for a different B (WRONG_B)", async () => {
    const { challengeId } = await createProviderLinkChallenge({ currentUserId: B, phone: PHONE, ownerAuthUserId: A_AUTH });
    expect(await loadLinkAttempt(challengeId, "someone-else")).toEqual({ ok: false, reason: "WRONG_B" });
  });

  it("rejects + deletes an expired challenge (EXPIRED)", async () => {
    const { challengeId } = await createProviderLinkChallenge({ currentUserId: B, phone: PHONE, ownerAuthUserId: A_AUTH });
    store.get(challengeId)!.expiresAt = new Date(Date.now() - 1000);
    expect(await loadLinkAttempt(challengeId, B)).toEqual({ ok: false, reason: "EXPIRED" });
    expect(store.has(challengeId)).toBe(false);
  });

  it("rejects an unknown / malformed id (NOT_FOUND)", async () => {
    expect(await loadLinkAttempt("not-a-valid-id", B)).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(await loadLinkAttempt("a".repeat(64), B)).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("rejects a row whose identifier is not the namespaced one (NOT_FOUND)", async () => {
    const { challengeId } = await createProviderLinkChallenge({ currentUserId: B, phone: PHONE, ownerAuthUserId: A_AUTH });
    store.get(challengeId)!.identifier = PHONE; // pretend a bare-phone Better Auth row shared the id
    expect(await loadLinkAttempt(challengeId, B)).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("loads a customer attempt (no otp/owner)", async () => {
    const { challengeId } = await createCustomerLinkAttempt({ currentUserId: B, phone: PHONE });
    const loaded = await loadLinkAttempt(challengeId, B);
    expect(loaded).toEqual({ ok: true, purpose: "CUSTOMER_CONVERGENCE", phone: PHONE });
  });
});

describe("verifyAndConsumeProviderProof", () => {
  async function fresh() {
    const { challengeId, code } = await createProviderLinkChallenge({ currentUserId: B, phone: PHONE, ownerAuthUserId: A_AUTH });
    const otpHash = JSON.parse(store.get(challengeId)!.value).otpHash as string;
    return { challengeId, code, otpHash };
  }

  it("accepts the correct OTP and atomically consumes the challenge (single-use)", async () => {
    const { challengeId, code, otpHash } = await fresh();
    expect(await verifyAndConsumeProviderProof({ challengeId, code, otpHash })).toEqual({ ok: true });
    expect(store.has(challengeId)).toBe(false); // consumed
    // A second submit of the same (already consumed) challenge cannot succeed.
    expect(await verifyAndConsumeProviderProof({ challengeId, code, otpHash })).toEqual({ ok: false, reason: "ALREADY_CONSUMED" });
  });

  it("rejects a wrong OTP without consuming (INVALID_OTP)", async () => {
    const { challengeId, otpHash } = await fresh();
    expect(await verifyAndConsumeProviderProof({ challengeId, code: "000000", otpHash })).toEqual({ ok: false, reason: "INVALID_OTP" });
    expect(store.has(challengeId)).toBe(true); // not consumed on a wrong code
  });

  it("rejects an empty OTP", async () => {
    const { challengeId, otpHash } = await fresh();
    expect(await verifyAndConsumeProviderProof({ challengeId, code: "  ", otpHash })).toEqual({ ok: false, reason: "INVALID_OTP" });
  });

  it("invalidates the challenge when attempts are exhausted (TOO_MANY_ATTEMPTS)", async () => {
    const { challengeId, code, otpHash } = await fresh();
    consumeRateLimitMock.mockResolvedValueOnce({ allowed: false });
    expect(await verifyAndConsumeProviderProof({ challengeId, code, otpHash })).toEqual({ ok: false, reason: "TOO_MANY_ATTEMPTS" });
    expect(store.has(challengeId)).toBe(false); // burned
  });

  it("only one of two concurrent correct submissions consumes/authorizes", async () => {
    const { challengeId, code, otpHash } = await fresh();
    const [r1, r2] = await Promise.all([
      verifyAndConsumeProviderProof({ challengeId, code, otpHash }),
      verifyAndConsumeProviderProof({ challengeId, code, otpHash }),
    ]);
    const oks = [r1, r2].filter((r) => r.ok).length;
    expect(oks).toBe(1); // at most one winner
    expect(store.has(challengeId)).toBe(false);
  });
});

describe("consume/invalidate helpers", () => {
  it("invalidateLinkAttempt deletes the namespaced row (and ignores malformed ids)", async () => {
    const { challengeId } = await createProviderLinkChallenge({ currentUserId: B, phone: PHONE, ownerAuthUserId: A_AUTH });
    await invalidateLinkAttempt(challengeId);
    expect(store.has(challengeId)).toBe(false);
    await invalidateLinkAttempt("bad-id"); // no throw
  });

  it("consumeCustomerLinkAttempt deletes the attempt row", async () => {
    const { challengeId } = await createCustomerLinkAttempt({ currentUserId: B, phone: PHONE });
    await consumeCustomerLinkAttempt(challengeId);
    expect(store.has(challengeId)).toBe(false);
  });
});
