import { describe, it, expect, vi, afterEach } from "vitest";

// Provider Notifications & Operational Alerts phase — regression tests
// for the new `kind` extraction added to getNotifications(). kind lives
// only inside the existing Json content column (see notify.ts's own
// comment — no Prisma schema change); this confirms it's read back
// correctly when present and safely undefined when absent (historical
// rows, or rows from a different writer like contract execution's own
// notify.ts, which never embeds a kind at all).

vi.mock("server-only", () => ({}));

const requireAuthMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuth: (...args: unknown[]) => requireAuthMock(...args),
}));

vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => "en"),
}));

const countMock = vi.fn();
const findManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    notification: {
      count: (...args: unknown[]) => countMock(...args),
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}));

const { getNotifications } = await import("./get-notifications");

afterEach(() => {
  requireAuthMock.mockReset();
  countMock.mockReset();
  findManyMock.mockReset();
});

describe("getNotifications — kind extraction", () => {
  it("returns the kind when the content JSON carries one", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([
      {
        id: "notif-1",
        content: { ar: "نص", en: "text", kind: "PENDING_PROVIDER" },
        readAt: null,
        createdAt: new Date(),
        causingBookingId: "booking-1",
      },
    ]);

    const result = await getNotifications();

    expect(result.items[0]!.kind).toBe("PENDING_PROVIDER");
  });

  it("returns undefined for a historical row with no kind key at all", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([
      {
        id: "notif-2",
        content: { ar: "نص", en: "text" },
        readAt: null,
        createdAt: new Date(),
        causingBookingId: null,
      },
    ]);

    const result = await getNotifications();

    expect(result.items[0]!.kind).toBeUndefined();
  });

  it("returns undefined rather than throwing for malformed content", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([
      { id: "notif-3", content: "not-an-object", readAt: null, createdAt: new Date(), causingBookingId: null },
    ]);

    const result = await getNotifications();

    expect(result.items[0]!.kind).toBeUndefined();
  });
});
