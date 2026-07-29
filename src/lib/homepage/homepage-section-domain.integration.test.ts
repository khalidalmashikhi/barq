import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 1.4 (Core Business Platform) — integration test for the Homepage
// Section domain, composing create -> reorder -> toggle -> query across
// real, unmocked business-logic modules against an in-memory fake Prisma
// store. Same rationale as feature-flag-domain.integration.test.ts: every
// existing test in this codebase mocks @/lib/db rather than connecting to
// a real database, and CI runs against a placeholder DATABASE_URL with no
// Postgres behind it.

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ admin: { id: "admin-1" } }),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

type FakeSection = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  visible: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

let store: Map<string, FakeSection>;
let nextId: number;

vi.mock("@/lib/db", () => ({
  prisma: {
    homepageSection: {
      findUnique: async ({ where }: { where: { id?: string; key?: string } }) => {
        const section = where.id ? store.get(where.id) : [...store.values()].find((s) => s.key === where.key);
        return section ?? null;
      },
      count: async () => store.size,
      findMany: async () =>
        [...store.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime()),
    },
    auditLog: { create: async () => ({}) },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        homepageSection: {
          aggregate: async () => ({
            _max: { sortOrder: store.size ? Math.max(...[...store.values()].map((s) => s.sortOrder)) : null },
          }),
          create: async (args: { data: { key: string; label: string; description: string | null; sortOrder: number } }) => {
            const section: FakeSection = {
              id: `019f4e4e-8116-7052-b15e-${String(nextId++).padStart(12, "0")}`,
              key: args.data.key,
              label: args.data.label,
              description: args.data.description,
              visible: false,
              sortOrder: args.data.sortOrder,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            store.set(section.id, section);
            return section;
          },
          update: async (args: { where: { id: string }; data: Partial<FakeSection> }) => {
            const existing = store.get(args.where.id);
            if (!existing) throw new Error("not found");
            const updated = { ...existing, ...args.data };
            store.set(args.where.id, updated as FakeSection);
            return updated;
          },
        },
        auditLog: { create: async () => ({}) },
      }),
  },
}));

const { createHomepageSection } = await import("./create-homepage-section");
const { showHomepageSection, hideHomepageSection } = await import("./toggle-homepage-section");
const { moveHomepageSectionUp, moveHomepageSectionDown } = await import("./reorder-homepage-section");
const { getHomepageSections } = await import("./get-homepage-sections");

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

beforeEach(() => {
  store = new Map();
  nextId = 1;
});

describe("Homepage Section domain integration (create -> reorder -> toggle -> query)", () => {
  it("a freshly created section is not visible, and the list reflects it", async () => {
    const created = await createHomepageSection(buildFormData({ key: "hero_banner", label: "Hero Banner", description: "" }));
    expect(created).toEqual({ ok: true, sectionId: expect.any(String) });

    const list = await getHomepageSections();
    expect(list.items).toEqual([expect.objectContaining({ key: "hero_banner", visible: false })]);
  });

  it("showing then hiding a section is reflected by the list", async () => {
    const created = await createHomepageSection(buildFormData({ key: "hero_banner", label: "Hero Banner", description: "" }));
    if (!created.ok) throw new Error("setup failed");

    const shown = await showHomepageSection(created.sectionId);
    expect(shown).toEqual({ ok: true });
    expect((await getHomepageSections()).items[0]).toEqual(expect.objectContaining({ visible: true }));

    const hidden = await hideHomepageSection(created.sectionId);
    expect(hidden).toEqual({ ok: true });
    expect((await getHomepageSections()).items[0]).toEqual(expect.objectContaining({ visible: false }));
  });

  it("refuses to create two sections with the same key", async () => {
    const first = await createHomepageSection(buildFormData({ key: "hero_banner", label: "Hero Banner", description: "" }));
    expect(first.ok).toBe(true);

    const second = await createHomepageSection(buildFormData({ key: "hero_banner", label: "Different", description: "" }));
    expect(second).toEqual({ ok: false, error: "KEY_TAKEN" });

    const list = await getHomepageSections();
    expect(list.items).toHaveLength(1);
  });

  it("reordering moves a section relative to its siblings, reflected in list order", async () => {
    const first = await createHomepageSection(buildFormData({ key: "hero_banner", label: "Hero", description: "" }));
    const second = await createHomepageSection(buildFormData({ key: "featured", label: "Featured", description: "" }));
    const third = await createHomepageSection(buildFormData({ key: "destinations", label: "Destinations", description: "" }));
    if (!first.ok || !second.ok || !third.ok) throw new Error("setup failed");

    let list = await getHomepageSections();
    expect(list.items.map((s) => s.key)).toEqual(["hero_banner", "featured", "destinations"]);

    const moved = await moveHomepageSectionUp(third.sectionId);
    expect(moved).toEqual({ ok: true });

    list = await getHomepageSections();
    expect(list.items.map((s) => s.key)).toEqual(["hero_banner", "destinations", "featured"]);

    const movedBack = await moveHomepageSectionDown(third.sectionId);
    expect(movedBack).toEqual({ ok: true });

    list = await getHomepageSections();
    expect(list.items.map((s) => s.key)).toEqual(["hero_banner", "featured", "destinations"]);
  });
});
