import { describe, it, expect, vi, afterEach } from "vitest";

// Customer → Provider Journey (C) — notifyProviderApplicationEvent() writes a
// single Notification row reusing the existing model shape: bilingual/8-locale
// content Json with an inline `kind`, the schema-compatible EMAIL channel, and
// NO causingBookingId (approval is not tied to a booking). No external
// email/SMS is dispatched — this is the in-app Notification Center record only.

vi.mock("server-only", () => ({}));

const createMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { notification: { create: (...a: unknown[]) => createMock(...a) } },
}));

const { notifyProviderApplicationEvent } = await import("./notify-provider-application");

afterEach(() => createMock.mockReset());

const ALL_LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;

describe("notifyProviderApplicationEvent", () => {
  it("creates a PROVIDER_APPROVED notification for the given user in all 8 locales", async () => {
    createMock.mockResolvedValue({});

    await notifyProviderApplicationEvent({ userId: "user-9", kind: "PROVIDER_APPROVED" });

    expect(createMock).toHaveBeenCalledTimes(1);
    const arg = createMock.mock.calls[0]![0] as {
      data: { userId: string; channel: string; content: Record<string, unknown> };
    };

    expect(arg.data.userId).toBe("user-9");
    expect(arg.data.channel).toBe("EMAIL");
    expect(arg.data.content.kind).toBe("PROVIDER_APPROVED");

    // Every BARQ locale has a non-empty rendered string (so extractLocalizedText
    // resolves natively for each, not via ar/en fallback).
    for (const locale of ALL_LOCALES) {
      expect(typeof arg.data.content[locale]).toBe("string");
      expect((arg.data.content[locale] as string).length).toBeGreaterThan(0);
    }

    // Not tied to a booking — the causing-booking link is omitted entirely.
    expect("causingBookingId" in arg.data).toBe(false);
  });

  it("propagates the write error to the caller (the caller decides isolation)", async () => {
    createMock.mockRejectedValue(new Error("db down"));
    await expect(
      notifyProviderApplicationEvent({ userId: "user-9", kind: "PROVIDER_APPROVED" })
    ).rejects.toThrow("db down");
  });
});
