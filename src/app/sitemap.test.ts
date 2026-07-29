import { describe, it, expect, vi, afterEach } from "vitest";

// Growth Foundations phase — regression tests for the dynamic sitemap.
// Confirms: real published services/approved providers are enumerated,
// draft/unpublished/unapproved/hidden content is never exposed, every
// entry is generated once per locale with correct hreflang alternates,
// and no authenticated/admin route ever appears.

vi.mock("@/lib/db", () => ({
  prisma: {
    service: { findMany: vi.fn() },
    provider: { findMany: vi.fn() },
  },
}));

const { prisma } = await import("@/lib/db");
const { default: sitemap } = await import("./sitemap");

const findManyServiceMock = prisma.service.findMany as unknown as ReturnType<typeof vi.fn>;
const findManyProviderMock = prisma.provider.findMany as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  findManyServiceMock.mockReset();
  findManyProviderMock.mockReset();
  delete process.env.NEXT_PUBLIC_APP_URL;
});

describe("sitemap", () => {
  it("queries only PUBLISHED services and only APPROVED+visible providers — never drafts/unapproved/hidden", async () => {
    findManyServiceMock.mockResolvedValue([]);
    findManyProviderMock.mockResolvedValue([]);

    await sitemap();

    expect(findManyServiceMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "PUBLISHED" } })
    );
    expect(findManyProviderMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "APPROVED", visible: true } })
    );
  });

  it("issues exactly one query per entity type regardless of locale count (no N+1)", async () => {
    findManyServiceMock.mockResolvedValue([]);
    findManyProviderMock.mockResolvedValue([]);

    await sitemap();

    expect(findManyServiceMock).toHaveBeenCalledTimes(1);
    expect(findManyProviderMock).toHaveBeenCalledTimes(1);
  });

  it("generates one entry per locale (8) for every static page", async () => {
    findManyServiceMock.mockResolvedValue([]);
    findManyProviderMock.mockResolvedValue([]);

    const entries = await sitemap();

    const homeEntries = entries.filter((e) => /\/(ar|en|de|it|pl|fr|cs|ru)$/.test(e.url));
    expect(homeEntries).toHaveLength(8);
  });

  it("generates a locale-prefixed URL and full hreflang alternates for each real service", async () => {
    findManyServiceMock.mockResolvedValue([
      { id: "service-1", updatedAt: new Date("2026-07-20T00:00:00Z") },
    ]);
    findManyProviderMock.mockResolvedValue([]);

    const entries = await sitemap();
    const serviceEntries = entries.filter((e) => e.url.includes("/services/service-1"));

    expect(serviceEntries).toHaveLength(8);
    const enEntry = serviceEntries.find((e) => e.url.includes("/en/"));
    expect(enEntry?.alternates?.languages).toMatchObject({
      ar: expect.stringContaining("/ar/services/service-1"),
      en: expect.stringContaining("/en/services/service-1"),
      "x-default": expect.stringContaining("/ar/services/service-1"),
    });
    expect(enEntry?.lastModified).toEqual(new Date("2026-07-20T00:00:00Z"));
  });

  it("uses a provider's slug when present, falling back to id otherwise", async () => {
    findManyServiceMock.mockResolvedValue([]);
    findManyProviderMock.mockResolvedValue([
      { id: "provider-1", slug: "desert-co", updatedAt: new Date() },
      { id: "provider-2", slug: null, updatedAt: new Date() },
    ]);

    const entries = await sitemap();

    expect(entries.some((e) => e.url.includes("/providers/desert-co"))).toBe(true);
    expect(entries.some((e) => e.url.includes("/providers/provider-2"))).toBe(true);
    expect(entries.some((e) => e.url.includes("/providers/provider-1"))).toBe(false);
  });

  it("never includes any authenticated or admin route", async () => {
    findManyServiceMock.mockResolvedValue([]);
    findManyProviderMock.mockResolvedValue([]);

    const entries = await sitemap();
    const urls = entries.map((e) => e.url);

    for (const forbidden of ["/admin", "/dashboard", "/bookings", "/notifications", "/payments", "/provider/", "/reviews"]) {
      expect(urls.some((u) => u.includes(forbidden))).toBe(false);
    }
  });

  it("falls back to localhost when NEXT_PUBLIC_APP_URL is unset", async () => {
    findManyServiceMock.mockResolvedValue([]);
    findManyProviderMock.mockResolvedValue([]);

    const entries = await sitemap();

    expect(entries[0]?.url).toMatch(/^http:\/\/localhost:3000\//);
  });
});
