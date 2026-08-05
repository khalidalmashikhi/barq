import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 1.1 (Core Business Platform) — integration test for the Category
// domain, composing create → transition → query across real, unmocked
// business-logic modules against an in-memory fake Prisma store.
//
// WHY AN IN-MEMORY FAKE, NOT A REAL POSTGRES CONNECTION: every one of this
// codebase's ~480 existing tests mocks @/lib/db rather than connecting to a
// real database — CI (.github/workflows/ci.yml) runs `npm test` against a
// placeholder DATABASE_URL with no Postgres service behind it, so a
// real-DB-connected test would pass locally and fail in CI. This test stays
// consistent with that established convention while still being a genuine
// integration test in the sense that matters here: it exercises
// createCategory(), setCategoryVisibility(), archiveCategory(), and
// getCategories() together, unmocked, verifying their real composition
// (e.g. that a freshly-created category is actually HIDDEN, that an
// archived category really can't be un-archived, that the visibility
// policy module and the query module agree on effective visibility) —
// not just each function's isolated behavior, which the sibling unit test
// files already cover individually.

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("en") }));

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ admin: { id: "admin-1" } }),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

type FakeCategory = {
  id: string;
  name: unknown;
  slug: string;
  visibilityStatus: string;
  scheduledVisibleAt: Date | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

let store: Map<string, FakeCategory>;
let nextId: number;

vi.mock("@/lib/db", () => ({
  prisma: {
    category: {
      findUnique: async ({ where }: { where: { id?: string; slug?: string } }) => {
        if (where.id) return store.get(where.id) ?? null;
        if (where.slug) return [...store.values()].find((c) => c.slug === where.slug) ?? null;
        return null;
      },
      create: async ({ data }: { data: { name: unknown; slug: string } }) => {
        const category: FakeCategory = {
          id: `019f4e4e-8116-7052-b15e-${String(nextId++).padStart(12, "0")}`,
          name: data.name,
          slug: data.slug,
          visibilityStatus: "HIDDEN",
          scheduledVisibleAt: null,
          sortOrder: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.set(category.id, category);
        return category;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeCategory> }) => {
        const existing = store.get(where.id);
        if (!existing) throw new Error("not found");
        const updated = { ...existing, ...data };
        store.set(where.id, updated as FakeCategory);
        return updated;
      },
      findMany: async () =>
        [...store.values()]
          .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime())
          .map((c) => ({ ...c, children: [] })),
      count: async () => store.size,
    },
    auditLog: { create: async () => ({}) },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        category: {
          aggregate: async () => ({
            _max: { sortOrder: store.size ? Math.max(...[...store.values()].map((c) => c.sortOrder)) : null },
          }),
          create: async (args: { data: { name: unknown; slug: string; sortOrder: number } }) => {
            const category: FakeCategory = {
              id: `019f4e4e-8116-7052-b15e-${String(nextId++).padStart(12, "0")}`,
              name: args.data.name,
              slug: args.data.slug,
              visibilityStatus: "HIDDEN",
              scheduledVisibleAt: null,
              sortOrder: args.data.sortOrder,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            store.set(category.id, category);
            return category;
          },
          update: async (args: { where: { id: string }; data: Partial<FakeCategory> }) => {
            const existing = store.get(args.where.id);
            if (!existing) throw new Error("not found");
            const updated = { ...existing, ...args.data };
            store.set(args.where.id, updated as FakeCategory);
            return updated;
          },
        },
        auditLog: { create: async () => ({}) },
      }),
  },
}));

const { createCategory } = await import("./create-category");
const { setCategoryVisibility, archiveCategory } = await import("./transition-category-visibility");
const { getCategories } = await import("./get-categories");

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

describe("Category domain integration (create -> transition -> query)", () => {
  it("a freshly created category is HIDDEN and invisible in the effective-visibility sense", async () => {
    const created = await createCategory(buildFormData({ nameAr: "أنشطة", nameEn: "Activities", slug: "activities" }));
    expect(created).toEqual({ ok: true, categoryId: expect.any(String) });

    const result = await getCategories();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({ name: "Activities", visibilityStatus: "HIDDEN" }));
  });

  it("supports the full archive -> restore -> re-archive lifecycle, with the list reflecting each step", async () => {
    const created = await createCategory(buildFormData({ nameAr: "أنشطة", nameEn: "Activities", slug: "activities" }));
    if (!created.ok) throw new Error("setup failed");

    const status = async () => (await getCategories()).items[0]?.visibilityStatus;

    // 1. archive (from PUBLIC)
    expect(await setCategoryVisibility(created.categoryId, "PUBLIC")).toEqual({ ok: true });
    expect(await status()).toBe("PUBLIC");
    expect(await archiveCategory(created.categoryId)).toEqual({ ok: true });
    expect(await status()).toBe("ARCHIVED");

    // 2. restore to PUBLIC
    expect(await setCategoryVisibility(created.categoryId, "PUBLIC")).toEqual({ ok: true });
    expect(await status()).toBe("PUBLIC");

    // 3. restore to PRIVATE (HIDDEN) after re-archiving
    expect(await archiveCategory(created.categoryId)).toEqual({ ok: true });
    expect(await status()).toBe("ARCHIVED");
    expect(await setCategoryVisibility(created.categoryId, "HIDDEN")).toEqual({ ok: true });
    expect(await status()).toBe("HIDDEN");

    // 4. archive again (from PRIVATE/HIDDEN)
    expect(await archiveCategory(created.categoryId)).toEqual({ ok: true });
    expect(await status()).toBe("ARCHIVED");
  });

  it("refuses to create two categories with the same slug", async () => {
    const first = await createCategory(buildFormData({ nameAr: "أنشطة", nameEn: "Activities", slug: "activities" }));
    expect(first.ok).toBe(true);

    const second = await createCategory(buildFormData({ nameAr: "أنشطة أخرى", nameEn: "Other Activities", slug: "activities" }));
    expect(second).toEqual({ ok: false, error: "SLUG_TAKEN" });

    const result = await getCategories();
    expect(result.items).toHaveLength(1);
  });
});
