import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 1.4 (Core Business Platform) — regression tests for
// createHomepageSection(), mirroring create-feature-flag.test.ts's shape.

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
const aggregateMock = vi.fn();
const createMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    homepageSection: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        homepageSection: {
          aggregate: (...args: unknown[]) => aggregateMock(...args),
          create: (...args: unknown[]) => createMock(...args),
        },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { createHomepageSection } = await import("./create-homepage-section");

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
  aggregateMock.mockReset();
  createMock.mockReset();
  auditCreateMock.mockReset();
});

describe("createHomepageSection", () => {
  it("returns INVALID_INPUT for a malformed key without checking admin status", async () => {
    const result = await createHomepageSection(buildFormData({ key: "Not A Valid Key!", label: "Hero", description: "" }));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT for a blank label", async () => {
    const result = await createHomepageSection(buildFormData({ key: "hero_banner", label: "  ", description: "" }));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns NO_ADMIN_PROFILE when the caller has no Admin profile", async () => {
    const { ForbiddenError } = await import("@/lib/auth");
    requireAdminMock.mockRejectedValue(new ForbiddenError("Admin role required"));

    const result = await createHomepageSection(buildFormData({ key: "hero_banner", label: "Hero", description: "" }));

    expect(result).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns KEY_TAKEN without creating anything when the key already exists", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: "existing-section" });

    const result = await createHomepageSection(buildFormData({ key: "hero_banner", label: "Hero", description: "" }));

    expect(result).toEqual({ ok: false, error: "KEY_TAKEN" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("creates the section not visible by default and records an audit event", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);
    aggregateMock.mockResolvedValue({ _max: { sortOrder: null } });
    createMock.mockResolvedValue({ id: "section-1" });
    auditCreateMock.mockResolvedValue({});

    const result = await createHomepageSection(
      buildFormData({ key: "hero_banner", label: "Hero Banner", description: "Top-of-page hero" })
    );

    expect(result).toEqual({ ok: true, sectionId: "section-1" });
    expect(createMock).toHaveBeenCalledWith({
      data: { key: "hero_banner", label: "Hero Banner", description: "Top-of-page hero", sortOrder: 0 },
    });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "ADMIN",
        actorId: "admin-1",
        action: "homepage_section.created",
        entityType: "HomepageSection",
        entityId: "section-1",
        newValue: expect.objectContaining({ visible: false }),
      }),
    });
  });

  it("appends after the existing highest sortOrder rather than always defaulting to 0", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);
    aggregateMock.mockResolvedValue({ _max: { sortOrder: 4 } });
    createMock.mockResolvedValue({ id: "section-2" });
    auditCreateMock.mockResolvedValue({});

    await createHomepageSection(buildFormData({ key: "featured", label: "Featured", description: "" }));

    expect(createMock).toHaveBeenCalledWith({
      data: { key: "featured", label: "Featured", description: null, sortOrder: 5 },
    });
  });
});
