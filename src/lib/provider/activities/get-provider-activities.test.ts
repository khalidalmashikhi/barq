import { describe, it, expect, vi, afterEach } from "vitest";

// Gate B4 — getProviderActivities() groups a provider's authorized links by
// provenance (never filters by source): the single SELF primary, the ADMIN
// grants, and the preserved LEGACY links.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/i18n/extract-localized-text", () => ({ extractLocalizedText: (v: { en?: string }) => v?.en ?? "" }));

const findManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { providerCategory: { findMany: (...a: unknown[]) => findManyMock(...a) } },
}));

const { getProviderActivities } = await import("./get-provider-activities");

afterEach(() => findManyMock.mockReset());

describe("getProviderActivities", () => {
  it("groups SELF primary / ADMIN / LEGACY and resolves labels", async () => {
    findManyMock.mockResolvedValue([
      { categoryId: "c-self", source: "SELF", isPrimary: true, grantedAt: null, category: { name: { en: "Tourism" }, slug: "tourism" } },
      { categoryId: "c-admin", source: "ADMIN", isPrimary: false, grantedAt: new Date("2026-08-10T00:00:00Z"), category: { name: { en: "Transport" }, slug: "transport" } },
      { categoryId: "c-legacy", source: "LEGACY", isPrimary: false, grantedAt: null, category: { name: { en: "Dining" }, slug: "dining" } },
    ]);

    const result = await getProviderActivities("prov-1", "en");

    expect(result.primary).toMatchObject({ categoryId: "c-self", label: "Tourism", source: "SELF", isPrimary: true });
    expect(result.adminGranted).toHaveLength(1);
    expect(result.adminGranted[0]).toMatchObject({ categoryId: "c-admin", label: "Transport", source: "ADMIN" });
    expect(result.legacy).toHaveLength(1);
    expect(result.legacy[0]).toMatchObject({ categoryId: "c-legacy", label: "Dining", source: "LEGACY" });
  });

  it("primary is null when the provider has no SELF/primary link", async () => {
    findManyMock.mockResolvedValue([
      { categoryId: "c-legacy", source: "LEGACY", isPrimary: false, grantedAt: null, category: { name: { en: "Dining" }, slug: "dining" } },
    ]);
    const result = await getProviderActivities("prov-1", "en");
    expect(result.primary).toBeNull();
    expect(result.legacy).toHaveLength(1);
  });
});
