import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const findFirstMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { category: { findFirst: (...args: unknown[]) => findFirstMock(...args) } },
}));

const { resolveAssignableCategory } = await import("./resolve-assignable-category");

const ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => findFirstMock.mockReset());

describe("resolveAssignableCategory (BR-028 authoritative vertical source)", () => {
  it("returns null for an invalid uuid without querying", async () => {
    expect(await resolveAssignableCategory("not-a-uuid")).toBeNull();
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it("queries by id + own-PUBLIC status only (no serviceType filter)", async () => {
    findFirstMock.mockResolvedValue(null);
    await resolveAssignableCategory(ID);
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ID, visibilityStatus: "PUBLIC" } })
    );
  });

  it("returns null when the category is not found (or not own-PUBLIC)", async () => {
    findFirstMock.mockResolvedValue(null);
    expect(await resolveAssignableCategory(ID)).toBeNull();
  });

  it("derives EXPERIENCE from a PUBLIC EXPERIENCE root", async () => {
    findFirstMock.mockResolvedValue({ visibilityStatus: "PUBLIC", serviceTypeKey: "EXPERIENCE", parent: null });
    expect(await resolveAssignableCategory(ID)).toEqual({ serviceTypeKey: "EXPERIENCE" });
  });

  it("derives RENTAL from a Cars/RENTAL category", async () => {
    findFirstMock.mockResolvedValue({ visibilityStatus: "PUBLIC", serviceTypeKey: "RENTAL", parent: null });
    expect(await resolveAssignableCategory(ID)).toEqual({ serviceTypeKey: "RENTAL" });
  });

  it("derives TRANSPORT from a Transfers/TRANSPORT category", async () => {
    findFirstMock.mockResolvedValue({ visibilityStatus: "PUBLIC", serviceTypeKey: "TRANSPORT", parent: null });
    expect(await resolveAssignableCategory(ID)).toEqual({ serviceTypeKey: "TRANSPORT" });
  });

  it("derives from a PUBLIC child under a PUBLIC parent", async () => {
    findFirstMock.mockResolvedValue({ visibilityStatus: "PUBLIC", serviceTypeKey: "EXPERIENCE", parent: { visibilityStatus: "PUBLIC" } });
    expect(await resolveAssignableCategory(ID)).toEqual({ serviceTypeKey: "EXPERIENCE" });
  });

  it("returns null for a PUBLIC child under a HIDDEN/ARCHIVED parent (effective visibility)", async () => {
    findFirstMock.mockResolvedValue({ visibilityStatus: "PUBLIC", serviceTypeKey: "EXPERIENCE", parent: { visibilityStatus: "HIDDEN" } });
    expect(await resolveAssignableCategory(ID)).toBeNull();
    findFirstMock.mockResolvedValue({ visibilityStatus: "PUBLIC", serviceTypeKey: "EXPERIENCE", parent: { visibilityStatus: "ARCHIVED" } });
    expect(await resolveAssignableCategory(ID)).toBeNull();
  });

  it("returns null when the stored serviceTypeKey is not a governed vertical", async () => {
    findFirstMock.mockResolvedValue({ visibilityStatus: "PUBLIC", serviceTypeKey: "BOGUS", parent: null });
    expect(await resolveAssignableCategory(ID)).toBeNull();
  });
});
