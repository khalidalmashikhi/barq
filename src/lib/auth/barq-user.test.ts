import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 5.1 (Production Readiness — self-service signup) — regression
// test for resolveBarqUser()'s three branches, with particular focus
// on the new behavior added this phase: a brand-new BARQ User now gets
// a Customer profile created atomically alongside it, closing the
// launch-blocking gap where a real signup could authenticate but never
// book (requireCustomer() would throw ForbiddenError forever with no
// self-service path to resolve it).

const findUniqueMock = vi.fn();
const findUniqueOrThrowMock = vi.fn();
const findFirstMock = vi.fn();
const updateMock = vi.fn();
const userCreateMock = vi.fn();
const customerCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      findFirst: (...args: unknown[]) => findFirstMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    },
    authUser: {
      findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrowMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        user: { create: (...args: unknown[]) => userCreateMock(...args) },
        customer: { create: (...args: unknown[]) => customerCreateMock(...args) },
      }),
  },
}));

const { resolveBarqUser } = await import("./barq-user");

afterEach(() => {
  findUniqueMock.mockReset();
  findUniqueOrThrowMock.mockReset();
  findFirstMock.mockReset();
  updateMock.mockReset();
  userCreateMock.mockReset();
  customerCreateMock.mockReset();
});

describe("resolveBarqUser", () => {
  it("returns the existing User when already linked by authUserId", async () => {
    const existing = { id: "user-1", authUserId: "auth-1" };
    findUniqueMock.mockResolvedValue(existing);

    const result = await resolveBarqUser("auth-1");

    expect(result).toBe(existing);
    expect(userCreateMock).not.toHaveBeenCalled();
    expect(customerCreateMock).not.toHaveBeenCalled();
  });

  it("links (not creates) an unlinked User found by phone number, without creating a Customer", async () => {
    findUniqueMock.mockResolvedValue(null);
    findUniqueOrThrowMock.mockResolvedValue({ id: "auth-2", phoneNumber: "+96890000001", phoneNumberVerified: true });
    const unlinked = { id: "user-2", phoneNumber: "+96890000001", authUserId: null };
    findFirstMock.mockResolvedValue(unlinked);
    const linked = { ...unlinked, authUserId: "auth-2" };
    updateMock.mockResolvedValue(linked);

    const result = await resolveBarqUser("auth-2");

    expect(updateMock).toHaveBeenCalledWith({ where: { id: "user-2" }, data: { authUserId: "auth-2" } });
    expect(result).toBe(linked);
    expect(userCreateMock).not.toHaveBeenCalled();
    expect(customerCreateMock).not.toHaveBeenCalled();
  });

  it("creates a new User AND its Customer profile atomically for a genuinely new phone number", async () => {
    findUniqueMock.mockResolvedValue(null);
    findUniqueOrThrowMock.mockResolvedValue({ id: "auth-3", phoneNumber: "+96890000002", phoneNumberVerified: true });
    findFirstMock.mockResolvedValue(null);
    const newUser = { id: "user-3", phoneNumber: "+96890000002", phoneNumberVerified: true, authUserId: "auth-3" };
    userCreateMock.mockResolvedValue(newUser);
    customerCreateMock.mockResolvedValue({ id: "customer-3", userId: "user-3" });

    const result = await resolveBarqUser("auth-3");

    expect(userCreateMock).toHaveBeenCalledWith({
      data: { phoneNumber: "+96890000002", phoneNumberVerified: true, authUserId: "auth-3" },
    });
    expect(customerCreateMock).toHaveBeenCalledWith({ data: { userId: "user-3" } });
    expect(result).toBe(newUser);
  });

  it("throws when the AuthUser has no phoneNumber", async () => {
    findUniqueMock.mockResolvedValue(null);
    findUniqueOrThrowMock.mockResolvedValue({ id: "auth-4", phoneNumber: null });

    await expect(resolveBarqUser("auth-4")).rejects.toThrow(/no phoneNumber/);
    expect(userCreateMock).not.toHaveBeenCalled();
    expect(customerCreateMock).not.toHaveBeenCalled();
  });
});
