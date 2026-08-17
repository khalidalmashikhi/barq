import { describe, it, expect, vi, afterEach } from "vitest";

// Gate B5 — the central service↔category authorization primitive. A provider is
// authorized for a category iff a ProviderCategory link exists on the composite
// PK (providerId, categoryId), regardless of provenance (SELF/ADMIN/LEGACY). A
// syntactically invalid id is unauthorized without ever hitting the DB.

vi.mock("server-only", () => ({}));

const findUniqueMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { providerCategory: { findUnique: (...a: unknown[]) => findUniqueMock(...a) } },
}));

const { isProviderAuthorizedForCategory } = await import("./assert-provider-authorized-for-category");

const PROVIDER = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
const CATEGORY = "019f4e4e-8116-7052-b15e-b79b5ccb1a01";

afterEach(() => findUniqueMock.mockReset());

describe("isProviderAuthorizedForCategory", () => {
  it("returns true when a ProviderCategory link exists (any provenance)", async () => {
    findUniqueMock.mockResolvedValue({ providerId: PROVIDER });

    const authorized = await isProviderAuthorizedForCategory(PROVIDER, CATEGORY);

    expect(authorized).toBe(true);
    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { providerId_categoryId: { providerId: PROVIDER, categoryId: CATEGORY } },
      select: { providerId: true },
    });
  });

  it("returns false when no link exists (provider not authorized for the category)", async () => {
    findUniqueMock.mockResolvedValue(null);

    expect(await isProviderAuthorizedForCategory(PROVIDER, CATEGORY)).toBe(false);
  });

  it("does not filter by provenance — a LEGACY or ADMIN link authorizes exactly like SELF", async () => {
    // The query never constrains `source`; existence alone is authorization.
    findUniqueMock.mockResolvedValue({ providerId: PROVIDER });
    await isProviderAuthorizedForCategory(PROVIDER, CATEGORY);

    const where = findUniqueMock.mock.calls[0]![0].where;
    expect(where).toEqual({ providerId_categoryId: { providerId: PROVIDER, categoryId: CATEGORY } });
    expect(JSON.stringify(where)).not.toContain("source");
  });

  it("returns false for a syntactically invalid id WITHOUT querying (never crashes on a bad @db.Uuid)", async () => {
    expect(await isProviderAuthorizedForCategory("not-a-uuid", CATEGORY)).toBe(false);
    expect(await isProviderAuthorizedForCategory(PROVIDER, "../../etc")).toBe(false);
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});
