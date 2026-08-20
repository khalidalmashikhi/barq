import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
const createMock = vi.fn();
vi.mock("./create-in-app-notification", () => ({ createInAppNotification: (...a: unknown[]) => createMock(...a) }));

const { notifyProviderOfVehicleEvent, VEHICLE_NOTIFICATION_EVENT } = await import("./vehicle-notification-events");

const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"];

afterEach(() => vi.clearAllMocks());

describe("notifyProviderOfVehicleEvent", () => {
  it("writes an IN_APP notification keyed to the Vehicle entity + assetId, to the provider's userId", async () => {
    await notifyProviderOfVehicleEvent(VEHICLE_NOTIFICATION_EVENT.CHANGES_REQUESTED, { providerUserId: "user-1", assetId: "asset-1" });
    expect(createMock).toHaveBeenCalledOnce();
    const arg = createMock.mock.calls[0]![0];
    expect(arg).toMatchObject({
      recipientUserId: "user-1",
      eventType: "vehicle.changes_requested",
      entityType: "Vehicle", // so the CTA resolver can deep-link to /provider/vehicles/[assetId]
      entityId: "asset-1",
    });
  });

  it("content carries all 8 locales + a kind, and NEVER PII / storage / admin data", async () => {
    for (const event of Object.values(VEHICLE_NOTIFICATION_EVENT)) {
      createMock.mockClear();
      await notifyProviderOfVehicleEvent(event, { providerUserId: "user-1", assetId: "asset-1" });
      const content = createMock.mock.calls[0]![0].content as Record<string, unknown>;
      for (const loc of LOCALES) {
        expect(typeof content[loc]).toBe("string");
        expect((content[loc] as string).length).toBeGreaterThan(0);
      }
      expect(typeof content.kind).toBe("string");
      const json = JSON.stringify(content);
      expect(json).not.toMatch(/objectKey|asset-documents\/|supabase|signedUrl|https?:\/\/|registration|admin/i);
    }
  });

  it("the APPROVED message never claims the vehicle is active / customer-available", async () => {
    await notifyProviderOfVehicleEvent(VEHICLE_NOTIFICATION_EVENT.VERIFICATION_APPROVED, { providerUserId: "u", assetId: "a" });
    const content = createMock.mock.calls[0]![0].content as Record<string, string>;
    const en = (content.en ?? "").toLowerCase();
    expect(en).toContain("approved");
    expect(en).not.toContain("active");
    expect(en).not.toContain("available to customers");
    expect(en).not.toContain("live");
  });
});
