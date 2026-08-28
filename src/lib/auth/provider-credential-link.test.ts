import { describe, it, expect, vi, beforeEach } from "vitest";

// AUTH-PROVIDER-LINK gate 2 — the transaction engine, exercised entirely via a mock DB
// (no OTP, no API, no live mutation). Proves: Provider A survives + keeps P + Provider
// row; E moves B→A; B retired + sessions killed; accounts/notifications re-parent; ZERO
// privilege/phone writes; and every unsafe topology fails closed with no partial writes.

vi.mock("server-only", () => ({}));
vi.mock("./linked-email", () => ({
  isSyntheticAuthEmail: (e: string | null | undefined) => typeof e === "string" && e.toLowerCase().endsWith("@phone.barq.internal"),
}));
vi.mock("@/lib/otp/audit", () => ({ maskPhoneNumber: (p: string) => `***${p.slice(-4)}` }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const auditCreateMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({
  recordAuditEvent: (params: unknown, db: { auditLog: { create: (x: unknown) => unknown } }) => db.auditLog.create({ data: params }),
}));

type Rec = {
  id: string;
  authUserId: string | null;
  status: string;
  phoneNumber: string | null;
  authEmail: string | null;
  authEmailVerified: boolean;
  authPhone: string | null;
  authPhoneVerified: boolean;
  provider?: boolean;
  staff?: boolean;
  admin?: boolean;
  hasCustomer?: boolean;
  history?: boolean;
  dangling?: boolean;
};

let store: Record<string, Rec> = {};
const authUserUpdate = vi.fn();
const userUpdate = vi.fn();
const userUpdateMany = vi.fn();
const accountUpdateMany = vi.fn();
const notifUpdateMany = vi.fn();
const sessionDeleteMany = vi.fn();
const authUserCreate = vi.fn();
const sessionCreate = vi.fn();
const auditLog = { create: (x: unknown) => auditCreateMock(x) };
const txThrows = { p2002: false };

function userFindUnique(args: { where: { id?: string; phoneNumber?: string }; select?: Record<string, unknown>; include?: unknown }) {
  const r = args.where.id
    ? store[args.where.id]
    : args.where.phoneNumber
      ? Object.values(store).find((x) => x.phoneNumber === args.where.phoneNumber)
      : undefined;
  if (!r) return null;
  if (args.select && !args.include) {
    const out: Record<string, unknown> = {};
    if (args.select.id) out.id = r.id;
    if (args.select.authUserId) out.authUserId = r.authUserId;
    return out;
  }
  return {
    id: r.id,
    phoneNumber: r.phoneNumber,
    status: r.status,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    authUser:
      r.authUserId === null || r.dangling
        ? null
        : { id: r.authUserId, email: r.authEmail, emailVerified: r.authEmailVerified, phoneNumber: r.authPhone, phoneNumberVerified: r.authPhoneVerified },
    providerLink: r.provider ? { id: "p" } : null,
    staff: r.staff ? { id: "s" } : null,
    admin: r.admin ? { id: "a" } : null,
    customer: r.hasCustomer === false ? null : { id: `c-${r.id}`, wallet: r.history ? { id: "w" } : null, _count: { bookings: r.history ? 1 : 0, reviews: 0, contracts: 0, supportTickets: 0 } },
  };
}

const dbShape = {
  authUser: {
    findUnique: vi.fn(async (args: { where: { phoneNumber: string } }) => {
      const r = Object.values(store).find((x) => x.authPhone === args.where.phoneNumber);
      return r ? { barqUser: { id: r.id } } : null;
    }),
    update: authUserUpdate,
    create: authUserCreate,
  },
  user: { findUnique: vi.fn(async (a: never) => userFindUnique(a)), update: userUpdate, updateMany: userUpdateMany },
  account: { updateMany: accountUpdateMany },
  notification: { updateMany: notifUpdateMany },
  session: { deleteMany: sessionDeleteMany, create: sessionCreate },
  auditLog,
};

vi.mock("@/lib/db", () => ({
  prisma: {
    ...dbShape,
    $transaction: async (fn: (t: typeof dbShape) => Promise<unknown>) => {
      const r = await fn(dbShape);
      if (txThrows.p2002) {
        const { Prisma } = await import("@prisma/client");
        throw new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "x" });
      }
      return r;
    },
  },
}));

const { linkProviderCredential } = await import("./provider-credential-link");

const PHONE = "+96891112222";

function setStore(recs: Rec[]) {
  store = {};
  for (const r of recs) store[r.id] = r;
}

// Provider owner A: verified phone P, a Provider row, a SYNTHETIC email (no real email), no staff/admin.
const providerA: Rec = {
  id: "A",
  authUserId: "aA",
  status: "ACTIVE",
  phoneNumber: PHONE,
  authEmail: "111@phone.barq.internal",
  authEmailVerified: false,
  authPhone: PHONE,
  authPhoneVerified: true,
  provider: true,
  hasCustomer: false,
};
// Ordinary current B: real verified email, no phone, no privilege, no history, a Customer.
const ordinaryB: Rec = {
  id: "B",
  authUserId: "aB",
  status: "ACTIVE",
  phoneNumber: null,
  authEmail: "b@example.com",
  authEmailVerified: true,
  authPhone: null,
  authPhoneVerified: false,
  hasCustomer: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  txThrows.p2002 = false;
  setStore([{ ...ordinaryB }, { ...providerA }]);
});

describe("linkProviderCredential — SUCCESS (provider survives, adopts email)", () => {
  it("A survives + keeps P + Provider; E moves B→A verified; B retired + sessions killed; audit once", async () => {
    const res = await linkProviderCredential("B", PHONE);
    expect(res).toEqual({ ok: true, survivorUserId: "A" });

    // E released from B, then claimed verified on A (release-before-claim).
    expect(authUserUpdate).toHaveBeenCalledWith({ where: { id: "aB" }, data: { email: null, emailVerified: false } });
    expect(authUserUpdate).toHaveBeenCalledWith({ where: { id: "aA" }, data: { email: "b@example.com", emailVerified: true } });

    // PHONE never moved: no update carries a phoneNumber field, on either side.
    for (const call of authUserUpdate.mock.calls) expect(call[0].data).not.toHaveProperty("phoneNumber");
    for (const call of userUpdate.mock.calls) expect(call[0].data ?? {}).not.toHaveProperty("phoneNumber");
    expect(userUpdateMany).not.toHaveBeenCalled();

    // Accounts + notifications re-parented B→A.
    expect(accountUpdateMany).toHaveBeenCalledWith({ where: { userId: "aB" }, data: { userId: "aA" } });
    expect(notifUpdateMany).toHaveBeenCalledWith({ where: { userId: "B" }, data: { userId: "A" } });

    // B retired (DEACTIVATED, not deleted) + sessions invalidated.
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: "B" }, data: { status: "DEACTIVATED" } });
    expect(sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: "aB" } });

    // No session created for A; no third AuthUser.
    expect(sessionCreate).not.toHaveBeenCalled();
    expect(authUserCreate).not.toHaveBeenCalled();

    // Audit emitted exactly once, provider preserved / phone not moved.
    expect(auditCreateMock).toHaveBeenCalledTimes(1);
    expect(auditCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "identity.provider_credential_link_committed",
          entityId: "A",
          newValue: expect.objectContaining({ survivorUserId: "A", retiredUserId: "B", movedEmail: true, movedPhone: false, privilegePreserved: true }),
        }),
      })
    );
  });

  it("A is the survivor — the current B can NEVER become survivor", async () => {
    const res = await linkProviderCredential("B", PHONE);
    expect(res).toEqual({ ok: true, survivorUserId: "A" });
    // B's User is deactivated, never A's.
    expect(userUpdate).not.toHaveBeenCalledWith({ where: { id: "A" }, data: { status: "DEACTIVATED" } });
  });
});

describe("linkProviderCredential — FAIL CLOSED (no mutation)", () => {
  const expectNoMutation = () => {
    expect(authUserUpdate).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(sessionDeleteMany).not.toHaveBeenCalled();
    expect(accountUpdateMany).not.toHaveBeenCalled();
    expect(auditCreateMock).not.toHaveBeenCalled();
  };

  it("owner has Staff → NOT_PROVIDER_LINK_ELIGIBLE, no mutation", async () => {
    setStore([{ ...ordinaryB }, { ...providerA, staff: true }]);
    expect(await linkProviderCredential("B", PHONE)).toEqual({ ok: false, error: "NOT_PROVIDER_LINK_ELIGIBLE" });
    expectNoMutation();
  });

  it("owner has Admin → NOT_PROVIDER_LINK_ELIGIBLE", async () => {
    setStore([{ ...ordinaryB }, { ...providerA, admin: true }]);
    expect(await linkProviderCredential("B", PHONE)).toEqual({ ok: false, error: "NOT_PROVIDER_LINK_ELIGIBLE" });
    expectNoMutation();
  });

  it("owner is not a Provider (ordinary customer) → NOT_PROVIDER_LINK_ELIGIBLE", async () => {
    setStore([{ ...ordinaryB }, { ...providerA, provider: false, hasCustomer: true }]);
    expect((await linkProviderCredential("B", PHONE)).ok).toBe(false);
    expectNoMutation();
  });

  it("current B is itself a Provider → NOT_PROVIDER_LINK_ELIGIBLE", async () => {
    setStore([{ ...ordinaryB, provider: true }, { ...providerA }]);
    expect(await linkProviderCredential("B", PHONE)).toEqual({ ok: false, error: "NOT_PROVIDER_LINK_ELIGIBLE" });
    expectNoMutation();
  });

  it("current B has Staff → NOT_PROVIDER_LINK_ELIGIBLE", async () => {
    setStore([{ ...ordinaryB, staff: true }, { ...providerA }]);
    expect((await linkProviderCredential("B", PHONE)).ok).toBe(false);
    expectNoMutation();
  });

  it("current B has Admin → NOT_PROVIDER_LINK_ELIGIBLE", async () => {
    setStore([{ ...ordinaryB, admin: true }, { ...providerA }]);
    expect((await linkProviderCredential("B", PHONE)).ok).toBe(false);
    expectNoMutation();
  });

  it("current B has unsafe history → NOT_PROVIDER_LINK_ELIGIBLE", async () => {
    setStore([{ ...ordinaryB, history: true }, { ...providerA }]);
    expect((await linkProviderCredential("B", PHONE)).ok).toBe(false);
    expectNoMutation();
  });

  it("current is the SAME identity as the owner → SAME_IDENTITY", async () => {
    setStore([{ ...providerA }]); // A owns P; call with currentUserId = A
    expect(await linkProviderCredential("A", PHONE)).toEqual({ ok: false, error: "SAME_IDENTITY" });
    expectNoMutation();
  });

  it("invalid bridge (owner User has no AuthUser) → OWNER_NOT_FOUND (never linkable)", async () => {
    // Owner phone is only on the User row with authUserId:null (no AuthUser owns P).
    setStore([{ ...ordinaryB }, { ...providerA, authUserId: null, authPhone: null }]);
    const res = await linkProviderCredential("B", PHONE);
    expect(res.ok).toBe(false); // findPhoneOwnerUserId → the null-bridge user → loadIdentitySide null → LOAD_FAILED
    expectNoMutation();
  });

  it("B's email not verified → LOSER_NOT_LINKABLE", async () => {
    setStore([{ ...ordinaryB, authEmailVerified: false }, { ...providerA }]);
    expect((await linkProviderCredential("B", PHONE)).ok).toBe(false);
    expectNoMutation();
  });

  it("E no longer owned by B (email null) → not linkable", async () => {
    setStore([{ ...ordinaryB, authEmail: null }, { ...providerA }]);
    expect((await linkProviderCredential("B", PHONE)).ok).toBe(false);
    expectNoMutation();
  });

  it("A no longer owns P (owner phone changed) → OWNER_PHONE_CHANGED", async () => {
    setStore([{ ...ordinaryB }, { ...providerA, authPhone: PHONE, authPhoneVerified: false }]);
    expect(await linkProviderCredential("B", PHONE)).toEqual({ ok: false, error: "OWNER_PHONE_CHANGED" });
    expectNoMutation();
  });

  it("A already holds a real verified email → SURVIVOR_HAS_EMAIL (never overwrite)", async () => {
    setStore([{ ...ordinaryB }, { ...providerA, authEmail: "a-real@example.com", authEmailVerified: true }]);
    expect(await linkProviderCredential("B", PHONE)).toEqual({ ok: false, error: "SURVIVOR_HAS_EMAIL" });
    expectNoMutation();
  });

  it("P2002 / Account collision during the tx → UNIQUE_RACE, fails closed", async () => {
    txThrows.p2002 = true;
    expect(await linkProviderCredential("B", PHONE)).toEqual({ ok: false, error: "UNIQUE_RACE" });
    // The tx ran the writes but the commit raised P2002 → treated as a race, no success audit acted upon.
  });
});

describe("linkProviderCredential — idempotency / security", () => {
  it("a second call after B is retired fails safely (no re-mutation)", async () => {
    setStore([{ ...ordinaryB, status: "DEACTIVATED", authEmail: null }, { ...providerA, authEmail: "b@example.com", authEmailVerified: true }]);
    const res = await linkProviderCredential("B", PHONE);
    expect(res.ok).toBe(false); // A now has the email → SURVIVOR_HAS_EMAIL / B retired → not linkable
    expect(authUserUpdate).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("never writes a Provider/Staff/Admin row, never creates a session or a third AuthUser", async () => {
    await linkProviderCredential("B", PHONE);
    // The engine has no provider/staff/admin update methods and never calls create/session.create.
    expect(authUserCreate).not.toHaveBeenCalled();
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it("an INVALID phone → INVALID_PHONE, no lookup/mutation", async () => {
    expect(await linkProviderCredential("B", "not-a-phone")).toEqual({ ok: false, error: "INVALID_PHONE" });
    expect(authUserUpdate).not.toHaveBeenCalled();
  });
});
