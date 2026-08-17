import { describe, it, expect, vi, afterEach } from "vitest";

// Gate B2 — the provider-notification event catalog + role-aware dispatchers.
// Proves: the stable eventType contract, role-aware routing (a provider event can
// never fan out to admins and vice-versa), server-derived recipients/entity
// metadata, and that NO content carries PII / free-text reason / objectKey / URL.

vi.mock("server-only", () => ({}));

const createInAppNotificationMock = vi.fn();
const notifyActiveAdminsMock = vi.fn();
vi.mock("./create-in-app-notification", () => ({
  createInAppNotification: (...a: unknown[]) => createInAppNotificationMock(...a),
  notifyActiveAdmins: (...a: unknown[]) => notifyActiveAdminsMock(...a),
}));

const { PROVIDER_NOTIFICATION_EVENT, notifyProviderOfEvent, notifyAdminsOfProviderEvent } = await import(
  "./provider-notification-events"
);

const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;

afterEach(() => {
  createInAppNotificationMock.mockReset();
  notifyActiveAdminsMock.mockReset();
});

describe("provider notification event contract", () => {
  it("exposes exactly the stable machine event names (never translated strings)", () => {
    expect(Object.values(PROVIDER_NOTIFICATION_EVENT).sort()).toEqual(
      [
        "provider.approved",
        "provider.changes_requested",
        "provider.changes_resubmitted",
        "provider.document_rejected",
        "provider.document_replaced",
        "provider.document_uploaded",
        "provider.rejected",
        "provider.verification_submitted",
      ].sort()
    );
  });
});

describe("notifyProviderOfEvent (provider-facing dispatch)", () => {
  it("routes a provider event to the owning provider's user with server-derived entity metadata", async () => {
    createInAppNotificationMock.mockResolvedValue(undefined);

    await notifyProviderOfEvent(PROVIDER_NOTIFICATION_EVENT.APPROVED, { providerUserId: "user-9", providerId: "prov-1" });

    expect(createInAppNotificationMock).toHaveBeenCalledTimes(1);
    const arg = createInAppNotificationMock.mock.calls[0]![0] as {
      recipientUserId: string; eventType: string; entityType: string; entityId: string; content: Record<string, unknown>;
    };
    expect(arg.recipientUserId).toBe("user-9");
    expect(arg.eventType).toBe("provider.approved");
    expect(arg.entityType).toBe("Provider");
    expect(arg.entityId).toBe("prov-1");
    expect(arg.content.kind).toBe("PROVIDER_APPROVED");
    expect(arg.content.en).toBeTypeOf("string");
    expect(arg.content.ar).toBeTypeOf("string");
  });

  it("REFUSES to send an admin event to a provider (role-aware guard)", async () => {
    await expect(
      notifyProviderOfEvent(PROVIDER_NOTIFICATION_EVENT.VERIFICATION_SUBMITTED, { providerUserId: "user-9", providerId: "prov-1" })
    ).rejects.toThrow(/non-provider event/);
    expect(createInAppNotificationMock).not.toHaveBeenCalled();
  });
});

describe("notifyAdminsOfProviderEvent (admin fan-out dispatch)", () => {
  it("routes an admin event to the active-admin fan-out with entity metadata", async () => {
    notifyActiveAdminsMock.mockResolvedValue(undefined);

    await notifyAdminsOfProviderEvent(PROVIDER_NOTIFICATION_EVENT.VERIFICATION_SUBMITTED, { providerId: "prov-1" });

    expect(notifyActiveAdminsMock).toHaveBeenCalledTimes(1);
    const arg = notifyActiveAdminsMock.mock.calls[0]![0] as { eventType: string; entityType: string; entityId: string };
    expect(arg.eventType).toBe("provider.verification_submitted");
    expect(arg.entityType).toBe("Provider");
    expect(arg.entityId).toBe("prov-1");
  });

  it("REFUSES to broadcast a provider event to admins (role-aware guard)", async () => {
    await expect(
      notifyAdminsOfProviderEvent(PROVIDER_NOTIFICATION_EVENT.APPROVED, { providerId: "prov-1" })
    ).rejects.toThrow(/non-admin event/);
    expect(notifyActiveAdminsMock).not.toHaveBeenCalled();
  });
});

describe("event content privacy + locale parity", () => {
  it("every event's content is full-8-locale, carries a kind, and leaks NO PII / reason / objectKey / URL", async () => {
    createInAppNotificationMock.mockResolvedValue(undefined);
    notifyActiveAdminsMock.mockResolvedValue(undefined);

    const providerEvents = ["provider.approved", "provider.rejected", "provider.changes_requested", "provider.document_rejected"] as const;
    const adminEvents = ["provider.verification_submitted", "provider.changes_resubmitted", "provider.document_uploaded", "provider.document_replaced"] as const;

    for (const e of providerEvents) await notifyProviderOfEvent(e, { providerUserId: "u", providerId: "p" });
    for (const e of adminEvents) await notifyAdminsOfProviderEvent(e, { providerId: "p" });

    const contents = [
      ...createInAppNotificationMock.mock.calls.map((c) => (c[0] as { content: Record<string, unknown> }).content),
      ...notifyActiveAdminsMock.mock.calls.map((c) => (c[0] as { content: Record<string, unknown> }).content),
    ];
    expect(contents).toHaveLength(8);
    for (const content of contents) {
      expect(typeof content.kind).toBe("string");
      for (const locale of LOCALES) expect(content[locale]).toBeTypeOf("string");
      const blob = JSON.stringify(content);
      expect(blob).not.toMatch(/objectKey|https?:\/\/|provider-documents\/|\+968|token/i);
    }
  });
});
