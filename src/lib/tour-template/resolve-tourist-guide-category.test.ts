import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const categoryFindUnique = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { category: { findUnique: (...a: unknown[]) => categoryFindUnique(...a) } },
}));

const { resolveTouristGuideCategoryId } = await import("./resolve-tourist-guide-category");

const TG = "cat-tourist-guides";

afterEach(() => categoryFindUnique.mockReset());

describe("resolveTouristGuideCategoryId", () => {
  it("resolves the id from the stable slug", async () => {
    categoryFindUnique.mockResolvedValue({ id: TG });
    expect(await resolveTouristGuideCategoryId()).toBe(TG);
    expect(categoryFindUnique).toHaveBeenCalledWith({ where: { slug: "tourist-guides" }, select: { id: true } });
  });

  it("returns null when the taxonomy row is absent (fail-closed)", async () => {
    categoryFindUnique.mockResolvedValue(null);
    expect(await resolveTouristGuideCategoryId()).toBeNull();
  });
});
