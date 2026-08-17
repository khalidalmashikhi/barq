import { describe, it, expect, vi, afterEach } from "vitest";

// Gate B3 (read-state security) — mark-one and mark-all are scoped to the
// authenticated user's OWN notifications, server-side. A mark-one can never
// target another user's row (the WHERE binds id AND userId together), and
// mark-all binds userId only — no client-supplied target is ever accepted. Both
// are idempotent (the readAt IS NULL guard makes a re-mark a no-op).

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const requireAuthMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAuth: (...a: unknown[]) => requireAuthMock(...a) }));

const updateManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { notification: { updateMany: (...a: unknown[]) => updateManyMock(...a) } },
}));

const { markNotificationRead } = await import("./mark-notification-read");
const { markAllNotificationsRead } = await import("./mark-all-notifications-read");

const UUID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAuthMock.mockReset();
  updateManyMock.mockReset();
});

describe("markNotificationRead", () => {
  it("scopes the update to BOTH the id AND the authenticated user's own userId", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    updateManyMock.mockResolvedValue({ count: 1 });

    await markNotificationRead(UUID);

    const arg = updateManyMock.mock.calls[0]![0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(arg.where).toEqual({ id: UUID, userId: "user-1", readAt: null });
    expect(arg.data).toEqual({ readAt: expect.any(Date) });
  });

  it("cannot target another user's row — the userId in the WHERE is always the session user's", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "attacker" } });
    updateManyMock.mockResolvedValue({ count: 0 }); // someone else's id → 0 rows matched
    await markNotificationRead(UUID);
    const arg = updateManyMock.mock.calls[0]![0] as { where: { userId: string } };
    expect(arg.where.userId).toBe("attacker"); // never a caller-supplied userId
  });

  it("rejects a malformed id before any DB work", async () => {
    const res = await markNotificationRead("not-a-uuid");
    expect(res).toEqual({ ok: false });
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(requireAuthMock).not.toHaveBeenCalled();
  });

  it("is idempotent: the readAt IS NULL guard makes a re-mark a harmless 0-row no-op", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    updateManyMock.mockResolvedValue({ count: 0 });
    await expect(markNotificationRead(UUID)).resolves.toBeDefined();
    expect((updateManyMock.mock.calls[0]![0] as { where: { readAt: null } }).where.readAt).toBeNull();
  });
});

describe("markAllNotificationsRead", () => {
  it("marks only the authenticated user's own unread rows (no client-supplied target)", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    updateManyMock.mockResolvedValue({ count: 3 });

    await markAllNotificationsRead();

    const arg = updateManyMock.mock.calls[0]![0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(arg.where).toEqual({ userId: "user-1", readAt: null });
    expect(arg.data).toEqual({ readAt: expect.any(Date) });
  });
});
