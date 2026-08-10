import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// Social Login — Gate 2 identity-bridge tests. These exercise the deterministic
// state machine in resolveBarqUser() and the explicit reconcileVerifiedPhone()
// completion/conflict path. To model the real security-critical behavior
// (uniqueness, concurrency, no silent merge), the mock below is a tiny in-memory
// "DB" that ENFORCES the same unique constraints the schema does:
//   • users.authUserId  @unique
//   • users.phoneNumber @unique (NULLs distinct — many phone-less users allowed)
// A violation throws a real Prisma P2002, exactly as production would, so the
// bridge's catch/refetch race handling is genuinely tested.

type UserRow = {
  id: string;
  phoneNumber: string | null;
  phoneNumberVerified: boolean;
  authUserId: string | null;
  // Marker relations, only to prove they are never moved/duplicated/deleted.
  hasProvider?: boolean;
  hasAdmin?: boolean;
};
type AuthUserRow = {
  id: string;
  email: string | null;
  name: string | null;
  phoneNumber: string | null;
  phoneNumberVerified: boolean;
};

let users: UserRow[];
let authUsers: AuthUserRow[];
let customerCreates: string[]; // userIds a Customer was created for
let idSeq: number;

function p2002(target: string) {
  return new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on ${target}`, {
    code: "P2002",
    clientVersion: "5.22.0",
    meta: { target: [target] },
  });
}

const userFindUnique = vi.fn(({ where }: { where: Record<string, unknown> }) => {
  if ("authUserId" in where) return Promise.resolve(users.find((u) => u.authUserId === where.authUserId) ?? null);
  if ("phoneNumber" in where) return Promise.resolve(users.find((u) => u.phoneNumber === where.phoneNumber) ?? null);
  if ("id" in where) return Promise.resolve(users.find((u) => u.id === where.id) ?? null);
  return Promise.resolve(null);
});
const userFindUniqueOrThrow = vi.fn(({ where }: { where: { id: string } }) => {
  const u = users.find((x) => x.id === where.id);
  if (!u) return Promise.reject(new Error("not found"));
  return Promise.resolve(u);
});
const userUpdateMany = vi.fn(({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
  const matches = users.filter((u) => Object.entries(where).every(([k, v]) => (u as Record<string, unknown>)[k] === v));
  // Enforce phoneNumber uniqueness on the write.
  if (typeof data.phoneNumber === "string") {
    const clash = users.find((u) => u.phoneNumber === data.phoneNumber && !matches.includes(u));
    if (clash) return Promise.reject(p2002("phoneNumber"));
  }
  matches.forEach((u) => Object.assign(u, data));
  return Promise.resolve({ count: matches.length });
});
const authUserFindUniqueOrThrow = vi.fn(({ where }: { where: { id: string } }) => {
  const a = authUsers.find((x) => x.id === where.id);
  if (!a) return Promise.reject(new Error("authUser not found"));
  return Promise.resolve(a);
});
const txUserCreate = vi.fn(({ data }: { data: Partial<UserRow> }) => {
  if (data.authUserId && users.some((u) => u.authUserId === data.authUserId)) return Promise.reject(p2002("authUserId"));
  if (data.phoneNumber && users.some((u) => u.phoneNumber === data.phoneNumber)) return Promise.reject(p2002("phoneNumber"));
  const row: UserRow = {
    id: `u${idSeq++}`,
    phoneNumber: data.phoneNumber ?? null,
    phoneNumberVerified: data.phoneNumberVerified ?? false,
    authUserId: data.authUserId ?? null,
  };
  users.push(row);
  return Promise.resolve(row);
});
const txCustomerCreate = vi.fn(({ data }: { data: { userId: string } }) => {
  customerCreates.push(data.userId);
  return Promise.resolve({ id: `c${idSeq++}`, userId: data.userId });
});

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: (...a: unknown[]) => userFindUnique(...(a as [{ where: Record<string, unknown> }])),
      findUniqueOrThrow: (...a: unknown[]) => userFindUniqueOrThrow(...(a as [{ where: { id: string } }])),
      updateMany: (...a: unknown[]) =>
        userUpdateMany(...(a as [{ where: Record<string, unknown>; data: Record<string, unknown> }])),
    },
    authUser: {
      findUniqueOrThrow: (...a: unknown[]) => authUserFindUniqueOrThrow(...(a as [{ where: { id: string } }])),
    },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        user: { create: (...a: unknown[]) => txUserCreate(...(a as [{ data: Partial<UserRow> }])) },
        customer: { create: (...a: unknown[]) => txCustomerCreate(...(a as [{ data: { userId: string } }])) },
      }),
  },
}));

const { resolveBarqUser, reconcileVerifiedPhone } = await import("./barq-user");

beforeEach(() => {
  users = [];
  authUsers = [];
  customerCreates = [];
  idSeq = 1;
  vi.clearAllMocks();
});

describe("resolveBarqUser — existing OTP identity", () => {
  it("1. returns the same BARQ User when the AuthUser is already linked (no writes)", async () => {
    authUsers.push({ id: "a1", email: "x@phone.barq.internal", name: null, phoneNumber: "+96811", phoneNumberVerified: true });
    users.push({ id: "u1", phoneNumber: "+96811", phoneNumberVerified: true, authUserId: "a1" });
    const user = await resolveBarqUser("a1");
    expect(user.id).toBe("u1");
    expect(txUserCreate).not.toHaveBeenCalled();
    expect(txCustomerCreate).not.toHaveBeenCalled();
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it("2. claims an existing UNLINKED legacy User with the same verified phone (no new User/Customer)", async () => {
    authUsers.push({ id: "a1", email: null, name: null, phoneNumber: "+96822", phoneNumberVerified: true });
    users.push({ id: "legacy", phoneNumber: "+96822", phoneNumberVerified: true, authUserId: null, hasProvider: true, hasAdmin: true });
    const user = await resolveBarqUser("a1");
    expect(user.id).toBe("legacy");
    expect(user.authUserId).toBe("a1"); // linked in place
    expect(txUserCreate).not.toHaveBeenCalled();
    expect(txCustomerCreate).not.toHaveBeenCalled();
  });

  it("3/4/5/6. preserves Provider/Admin/Customer on the claimed legacy User; creates no duplicate Customer", async () => {
    authUsers.push({ id: "a1", email: null, name: null, phoneNumber: "+96833", phoneNumberVerified: true });
    users.push({ id: "legacy", phoneNumber: "+96833", phoneNumberVerified: true, authUserId: null, hasProvider: true, hasAdmin: true });
    const user = await resolveBarqUser("a1");
    expect(user.id).toBe("legacy");
    expect(users.find((u) => u.id === "legacy")!.hasProvider).toBe(true);
    expect(users.find((u) => u.id === "legacy")!.hasAdmin).toBe(true);
    expect(customerCreates).toHaveLength(0);
    expect(users).toHaveLength(1); // no duplicate identity
  });
});

describe("resolveBarqUser — social-first identity", () => {
  it("7. creates a phone-less User + Customer for a social AuthUser with no phone", async () => {
    authUsers.push({ id: "g1", email: "person@gmail.com", name: "Person", phoneNumber: null, phoneNumberVerified: false });
    const user = await resolveBarqUser("g1");
    expect(user.phoneNumber).toBeNull();
    expect(user.phoneNumberVerified).toBe(false);
    expect(user.authUserId).toBe("g1");
    expect(customerCreates).toEqual([user.id]); // exactly one Customer
    expect(userUpdateMany).not.toHaveBeenCalled(); // no claim attempt (no verified phone)
  });

  it("8. repeated resolve returns the SAME User (idempotent)", async () => {
    authUsers.push({ id: "g1", email: "person@gmail.com", name: null, phoneNumber: null, phoneNumberVerified: false });
    const first = await resolveBarqUser("g1");
    const second = await resolveBarqUser("g1");
    expect(second.id).toBe(first.id);
    expect(users).toHaveLength(1);
    expect(customerCreates).toHaveLength(1);
  });

  it("9. concurrent first-resolve yields ONE User (P2002 on authUserId → refetch winner)", async () => {
    authUsers.push({ id: "g1", email: null, name: null, phoneNumber: null, phoneNumberVerified: false });
    // Simulate a concurrent winner creating the row between our Case-A miss and
    // our own create: the create throws P2002 after the winner row exists.
    txUserCreate.mockImplementationOnce(() => {
      users.push({ id: "winner", phoneNumber: null, phoneNumberVerified: false, authUserId: "g1" });
      return Promise.reject(p2002("authUserId"));
    });
    const user = await resolveBarqUser("g1");
    expect(user.id).toBe("winner");
    expect(users.filter((u) => u.authUserId === "g1")).toHaveLength(1);
  });
});

describe("reconcileVerifiedPhone — completion & conflict", () => {
  it("10/11/12. attaches a newly-verified UNUSED phone to the same phone-less User (no new Customer, relations intact)", async () => {
    authUsers.push({ id: "g1", email: null, name: null, phoneNumber: "+96844", phoneNumberVerified: true });
    users.push({ id: "u1", phoneNumber: null, phoneNumberVerified: false, authUserId: "g1", hasProvider: true, hasAdmin: true });
    const result = await reconcileVerifiedPhone("g1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe("u1");
      expect(result.user.phoneNumber).toBe("+96844");
    }
    // Relations on the same row are untouched (read from the in-memory state).
    expect(users.find((u) => u.id === "u1")!.hasProvider).toBe(true);
    expect(users.find((u) => u.id === "u1")!.hasAdmin).toBe(true);
    expect(customerCreates).toHaveLength(0);
    expect(txUserCreate).not.toHaveBeenCalled();
  });

  it("13/14/15/16. HARD CONFLICT when the verified phone belongs to another User — nothing moved/modified", async () => {
    authUsers.push({ id: "g1", email: null, name: null, phoneNumber: "+96855", phoneNumberVerified: true });
    users.push({ id: "social", phoneNumber: null, phoneNumberVerified: false, authUserId: "g1" });
    users.push({ id: "other", phoneNumber: "+96855", phoneNumberVerified: true, authUserId: "a2", hasProvider: true, hasAdmin: true });
    const result = await reconcileVerifiedPhone("g1");
    expect(result).toEqual({ ok: false, error: "PHONE_ALREADY_LINKED_TO_ANOTHER_ACCOUNT" });
    // Neither user modified; no relation moved; no write attempted.
    expect(users.find((u) => u.id === "social")!.phoneNumber).toBeNull();
    expect(users.find((u) => u.id === "other")!.authUserId).toBe("a2");
    expect(userUpdateMany).not.toHaveBeenCalled();
    expect(txUserCreate).not.toHaveBeenCalled();
  });

  it("returns NO_VERIFIED_PHONE when the AuthUser's phone is unverified", async () => {
    authUsers.push({ id: "g1", email: null, name: null, phoneNumber: "+96866", phoneNumberVerified: false });
    users.push({ id: "u1", phoneNumber: null, phoneNumberVerified: false, authUserId: "g1" });
    expect(await reconcileVerifiedPhone("g1")).toEqual({ ok: false, error: "NO_VERIFIED_PHONE" });
  });
});

describe("resolveBarqUser — security invariants", () => {
  it("17. an UNVERIFIED phone never claims an existing User (creates a phone-less User instead)", async () => {
    authUsers.push({ id: "g1", email: null, name: null, phoneNumber: "+96877", phoneNumberVerified: false });
    users.push({ id: "legacy", phoneNumber: "+96877", phoneNumberVerified: true, authUserId: null, hasAdmin: true });
    const user = await resolveBarqUser("g1");
    expect(user.id).not.toBe("legacy"); // legacy NOT claimed
    expect(user.phoneNumber).toBeNull();
    expect(userUpdateMany).not.toHaveBeenCalled(); // no claim attempt
    expect(users.find((u) => u.id === "legacy")!.authUserId).toBeNull(); // untouched
  });

  it("18/19. matching email / name never triggers reconciliation (no claim by identity data)", async () => {
    authUsers.push({ id: "g1", email: "shared@gmail.com", name: "Same Name", phoneNumber: null, phoneNumberVerified: false });
    users.push({ id: "legacy", phoneNumber: "+96888", phoneNumberVerified: true, authUserId: null });
    const user = await resolveBarqUser("g1");
    expect(user.id).not.toBe("legacy");
    expect(user.authUserId).toBe("g1");
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it("20. Apple relay-style email is never used as an identity key", async () => {
    authUsers.push({ id: "ap1", email: "abc123@privaterelay.appleid.com", name: null, phoneNumber: null, phoneNumberVerified: false });
    users.push({ id: "legacy", phoneNumber: "+96899", phoneNumberVerified: true, authUserId: null });
    const user = await resolveBarqUser("ap1");
    expect(user.id).not.toBe("legacy");
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it("21. a legacy claim only ever targets an UNLINKED User (WHERE includes authUserId: null)", async () => {
    authUsers.push({ id: "a1", email: null, name: null, phoneNumber: "+96810", phoneNumberVerified: true });
    users.push({ id: "legacy", phoneNumber: "+96810", phoneNumberVerified: true, authUserId: null });
    await resolveBarqUser("a1");
    expect(userUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ phoneNumber: "+96810", authUserId: null }) })
    );
  });
});

describe("resolveBarqUser — regression", () => {
  it("22. brand-new verified-phone OTP user → User(with phone)+Customer (phone-only flow preserved)", async () => {
    authUsers.push({ id: "a1", email: "+96820@phone.barq.internal", name: null, phoneNumber: "+96820", phoneNumberVerified: true });
    const user = await resolveBarqUser("a1");
    expect(user.phoneNumber).toBe("+96820");
    expect(user.phoneNumberVerified).toBe(true);
    expect(user.authUserId).toBe("a1");
    expect(customerCreates).toEqual([user.id]);
  });

  it("23-26. a linked User (any role) is returned unchanged — the bridge never inspects role/status", async () => {
    // Provider/Admin/Customer/suspended all resolve identically: the bridge just
    // returns the linked User; RBAC (rbac.test.ts) enforces role/status downstream.
    authUsers.push({ id: "a1", email: null, name: null, phoneNumber: "+96830", phoneNumberVerified: true });
    users.push({ id: "u1", phoneNumber: "+96830", phoneNumberVerified: true, authUserId: "a1", hasProvider: true, hasAdmin: true });
    const user = await resolveBarqUser("a1");
    expect(user.id).toBe("u1");
    expect(users.find((u) => u.id === "u1")!.hasProvider).toBe(true);
    expect(users.find((u) => u.id === "u1")!.hasAdmin).toBe(true);
    expect(txUserCreate).not.toHaveBeenCalled();
    expect(userUpdateMany).not.toHaveBeenCalled();
  });
});
