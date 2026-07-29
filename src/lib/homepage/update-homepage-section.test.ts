import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 1.4 (Core Business Platform) — regression tests for
// updateHomepageSection(), mirroring update-feature-flag.test.ts's shape.
// Only `label`/`description` are mutable — confirms `key` is never
// touched.

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

const { updateHomepageSection } = await import("./update-homepage-section");

const SECTION_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

afterEach(() => {
  requireAdminMock.mockReset();
  findUniqueMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("updateHomepageSection", () => {
  it("returns SECTION_NOT_FOUND when the section doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);

    const result = await updateHomepageSection(SECTION_ID, buildFormData({ label: "New Label", description: "New description" }));

    expect(result).toEqual({ ok: false, error: "SECTION_NOT_FOUND" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("updates only the label and description, never the key", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: SECTION_ID, key: "hero_banner", label: "Old", description: "Old description" });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await updateHomepageSection(SECTION_ID, buildFormData({ label: "New Label", description: "New description" }));

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: SECTION_ID },
      data: { label: "New Label", description: "New description" },
    });
    expect(updateMock.mock.calls[0]?.[0].data).not.toHaveProperty("key");
  });
});
