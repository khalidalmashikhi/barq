import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 1.4 (Core Business Platform) — regression tests for
// showHomepageSection()/hideHomepageSection(), mirroring
// toggle-feature-flag.test.ts's shape.

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const findUniqueMock = vi.fn();
const updateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    homepageSection: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        homepageSection: { update: (...args: unknown[]) => updateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { showHomepageSection, hideHomepageSection } = await import("./toggle-homepage-section");

const SECTION_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  findUniqueMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("showHomepageSection", () => {
  it("sets visible=true and records action homepage_section.shown", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: SECTION_ID, visible: false });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await showHomepageSection(SECTION_ID);

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: SECTION_ID }, data: { visible: true } });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "homepage_section.shown", newValue: { visible: true } }),
    });
  });

  it("returns SECTION_NOT_FOUND when the section doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);

    const result = await showHomepageSection(SECTION_ID);

    expect(result).toEqual({ ok: false, error: "SECTION_NOT_FOUND" });
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("hideHomepageSection", () => {
  it("sets visible=false and records action homepage_section.hidden", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: SECTION_ID, visible: true });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await hideHomepageSection(SECTION_ID);

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: SECTION_ID }, data: { visible: false } });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "homepage_section.hidden", newValue: { visible: false } }),
    });
  });
});
