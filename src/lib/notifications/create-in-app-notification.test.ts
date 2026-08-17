import { describe, it, expect, vi, afterEach } from "vitest";

// Gate B2 — the central IN_APP notification writer + admin fan-out. Proves the
// row-level invariants (channel IN_APP, structured eventType/entityType/entityId),
// that the admin fan-out derives recipients server-side from ACTIVE Admin rows
// only, produces one row per admin, and is a safe no-op with zero active admins.

vi.mock("server-only", () => ({}));

const notificationCreateMock = vi.fn();
const notificationCreateManyMock = vi.fn();
const adminFindManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    notification: {
      create: (...a: unknown[]) => notificationCreateMock(...a),
      createMany: (...a: unknown[]) => notificationCreateManyMock(...a),
    },
    admin: { findMany: (...a: unknown[]) => adminFindManyMock(...a) },
  },
}));

const { createInAppNotification, notifyActiveAdmins } = await import("./create-in-app-notification");

afterEach(() => {
  notificationCreateMock.mockReset();
  notificationCreateManyMock.mockReset();
  adminFindManyMock.mockReset();
});

describe("createInAppNotification", () => {
  it("writes a single IN_APP row with the stable eventType and server-derived entity metadata", async () => {
    notificationCreateMock.mockResolvedValue({});

    await createInAppNotification({
      recipientUserId: "user-1",
      eventType: "provider.approved",
      entityType: "Provider",
      entityId: "prov-1",
      content: { en: "Approved", ar: "تم", kind: "PROVIDER_APPROVED" },
    });

    expect(notificationCreateMock).toHaveBeenCalledTimes(1);
    const arg = notificationCreateMock.mock.calls[0]![0] as {
      data: { userId: string; channel: string; eventType: string; entityType: string; entityId: string; content: Record<string, unknown> };
    };
    expect(arg.data.userId).toBe("user-1");
    expect(arg.data.channel).toBe("IN_APP");
    expect(arg.data.eventType).toBe("provider.approved");
    expect(arg.data.entityType).toBe("Provider");
    expect(arg.data.entityId).toBe("prov-1");
    expect(arg.data.content.kind).toBe("PROVIDER_APPROVED");
  });
});

describe("notifyActiveAdmins", () => {
  it("fans out ONE IN_APP row per ACTIVE admin, derived server-side from Admin.userId", async () => {
    adminFindManyMock.mockResolvedValue([{ userId: "admin-user-1" }, { userId: "admin-user-2" }]);
    notificationCreateManyMock.mockResolvedValue({ count: 2 });

    await notifyActiveAdmins({
      eventType: "provider.verification_submitted",
      entityType: "Provider",
      entityId: "prov-1",
      content: { en: "Submitted", ar: "أُرسل" },
    });

    // Recipients come ONLY from the ACTIVE-admin query (never caller input).
    expect(adminFindManyMock).toHaveBeenCalledWith({ where: { status: "ACTIVE" }, select: { userId: true } });
    expect(notificationCreateManyMock).toHaveBeenCalledTimes(1);
    const arg = notificationCreateManyMock.mock.calls[0]![0] as {
      data: Array<{ userId: string; channel: string; eventType: string; entityType: string; entityId: string }>;
    };
    expect(arg.data).toHaveLength(2);
    expect(arg.data.map((d) => d.userId).sort()).toEqual(["admin-user-1", "admin-user-2"]);
    expect(arg.data.every((d) => d.channel === "IN_APP")).toBe(true);
    expect(arg.data.every((d) => d.eventType === "provider.verification_submitted")).toBe(true);
    expect(arg.data.every((d) => d.entityId === "prov-1")).toBe(true);
  });

  it("is a safe no-op when there are zero ACTIVE admins (never writes)", async () => {
    adminFindManyMock.mockResolvedValue([]);

    await notifyActiveAdmins({ eventType: "provider.document_uploaded", entityType: "Provider", entityId: "prov-1", content: { en: "x", ar: "x" } });

    expect(notificationCreateManyMock).not.toHaveBeenCalled();
  });
});
