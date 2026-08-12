import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const findFirstMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { category: { findFirst: (...args: unknown[]) => findFirstMock(...args) } },
}));

const { assertAssignableCategory } = await import("./assert-assignable-category");

const ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => findFirstMock.mockReset());

describe("assertAssignableCategory", () => {
  it("rejects an invalid uuid without querying", async () => {
    expect(await assertAssignableCategory("not-a-uuid", "EXPERIENCE")).toBe(false);
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it("rejects when the category fails the shared where (not found)", async () => {
    findFirstMock.mockResolvedValue(null);
    expect(await assertAssignableCategory(ID, "EXPERIENCE")).toBe(false);
  });

  it("resolves the category by id + own-PUBLIC status (the vertical is matched in code, not the query)", async () => {
    findFirstMock.mockResolvedValue(null);
    await assertAssignableCategory(ID, "EXPERIENCE");
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: ID, visibilityStatus: "PUBLIC" }),
      })
    );
    // serviceType is NO LONGER filtered in SQL — it is derived from the resolved
    // category and compared in code (so the same lookup can also DERIVE it).
    expect(findFirstMock.mock.calls[0]![0].where).not.toHaveProperty("serviceTypeKey");
  });

  it("accepts a PUBLIC root of the matching serviceType", async () => {
    findFirstMock.mockResolvedValue({ visibilityStatus: "PUBLIC", serviceTypeKey: "EXPERIENCE", parent: null });
    expect(await assertAssignableCategory(ID, "EXPERIENCE")).toBe(true);
  });

  it("rejects a serviceType mismatch (category is RENTAL, asserted against EXPERIENCE)", async () => {
    findFirstMock.mockResolvedValue({ visibilityStatus: "PUBLIC", serviceTypeKey: "RENTAL", parent: null });
    expect(await assertAssignableCategory(ID, "EXPERIENCE")).toBe(false);
  });

  it("accepts a PUBLIC child under a PUBLIC parent", async () => {
    findFirstMock.mockResolvedValue({ visibilityStatus: "PUBLIC", serviceTypeKey: "EXPERIENCE", parent: { visibilityStatus: "PUBLIC" } });
    expect(await assertAssignableCategory(ID, "EXPERIENCE")).toBe(true);
  });

  it("rejects a PUBLIC child under a HIDDEN parent (effective visibility)", async () => {
    findFirstMock.mockResolvedValue({ visibilityStatus: "PUBLIC", serviceTypeKey: "EXPERIENCE", parent: { visibilityStatus: "HIDDEN" } });
    expect(await assertAssignableCategory(ID, "EXPERIENCE")).toBe(false);
  });
});
