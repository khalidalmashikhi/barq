import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {}
  return { requireAuth: vi.fn(), UnauthenticatedError, ForbiddenError };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));
vi.mock("@/lib/auth", () => ({
  requireAuth: (...a: unknown[]) => h.requireAuth(...a),
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
}));

const getNotificationsMock = vi.fn();
vi.mock("@/lib/notifications/get-notifications", () => ({
  getNotifications: (...a: unknown[]) => getNotificationsMock(...a),
}));

const { GET } = await import("./route");

beforeEach(() => {
  h.requireAuth.mockReset();
  getNotificationsMock.mockReset();
});

describe("GET /api/v1/me/notifications", () => {
  it("401 without a session", async () => {
    h.requireAuth.mockRejectedValue(new h.UnauthenticatedError());
    const res = await GET(new Request("http://x/api/v1/me/notifications"));
    expect(res.status).toBe(401);
    expect(getNotificationsMock).not.toHaveBeenCalled();
  });

  it("200 maps DTOs, preserves read/unread, forwards locale + default pageSize 20", async () => {
    h.requireAuth.mockResolvedValue({ authUserId: "au1", barqUser: { id: "u1" } });
    getNotificationsMock.mockResolvedValue({
      items: [
        {
          id: "n1",
          message: "تم تأكيد حجزك",
          isRead: false,
          createdAt: new Date("2026-05-01T00:00:00.000Z"),
          causingBookingId: "b1",
          kind: "BOOKING_CONFIRMED",
        },
      ],
      totalCount: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    const res = await GET(new Request("http://x/api/v1/me/notifications?locale=ar"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(getNotificationsMock).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 20 }), "ar");
    const body = await res.json();
    expect(body.items[0]).toEqual({
      id: "n1",
      message: "تم تأكيد حجزك",
      kind: "BOOKING_CONFIRMED",
      isRead: false,
      causingBookingId: "b1",
      createdAt: "2026-05-01T00:00:00.000Z",
    });
  });
});
