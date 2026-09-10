import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Phase 3B — Phase 1 (Blocker 1). The server-authoritative OfferingKind classifier: RENTAL from
// serviceType; TOUR from the verified tourist-guide category; null otherwise. Proves a guided tour
// is anchored to the tourist-guide CATEGORY (not every EXPERIENCE) and that classification is
// fail-closed when the taxonomy row is absent.

vi.mock("server-only", () => ({}));

const categoryFindUniqueMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { category: { findUnique: (...a: unknown[]) => categoryFindUniqueMock(...a) } },
}));

const { resolveOfferingKindForService } = await import("./resolve-offering-kind");

const TG_CAT = "tg-cat";

beforeEach(() => {
  // resolveTouristGuideCategoryId resolves the canonical tourist-guide category id.
  categoryFindUniqueMock.mockResolvedValue({ id: TG_CAT });
});
afterEach(() => vi.clearAllMocks());

describe("resolveOfferingKindForService", () => {
  it("classifies a RENTAL serviceType as VEHICLE_RENTAL without consulting the taxonomy", async () => {
    expect(await resolveOfferingKindForService({ serviceType: "RENTAL", categoryId: "anything" })).toBe("VEHICLE_RENTAL");
    expect(categoryFindUniqueMock).not.toHaveBeenCalled();
  });

  it("classifies a service in the verified tourist-guide category as TOUR", async () => {
    expect(await resolveOfferingKindForService({ serviceType: "EXPERIENCE", categoryId: TG_CAT })).toBe("TOUR");
  });

  it("does NOT classify a plain EXPERIENCE in a different category as TOUR (never all EXPERIENCE)", async () => {
    expect(await resolveOfferingKindForService({ serviceType: "EXPERIENCE", categoryId: "some-other-cat" })).toBeNull();
    expect(await resolveOfferingKindForService({ serviceType: "EXPERIENCE", categoryId: null })).toBeNull();
  });

  it("fails closed: when the tourist-guide taxonomy row is absent, no TOUR classification", async () => {
    categoryFindUniqueMock.mockResolvedValue(null);
    expect(await resolveOfferingKindForService({ serviceType: "EXPERIENCE", categoryId: TG_CAT })).toBeNull();
  });

  it("returns null for other non-regulated service types (TRANSPORT/ACCOMMODATION) regardless of category", async () => {
    expect(await resolveOfferingKindForService({ serviceType: "TRANSPORT", categoryId: "c" })).toBeNull();
    expect(await resolveOfferingKindForService({ serviceType: "ACCOMMODATION", categoryId: "c" })).toBeNull();
  });
});
