import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 2 (Provider Foundation) — integration test composing
// createProvider() -> publishProvider()/unpublishProvider() ->
// archiveProvider() -> getProviders() across real, unmocked
// business-logic modules against an in-memory fake Prisma store. Same
// rationale as category-domain.integration.test.ts /
// feature-flag-domain.integration.test.ts /
// homepage-section-domain.integration.test.ts: every existing test in
// this codebase mocks @/lib/db rather than connecting to a real
// database, and CI runs against a placeholder DATABASE_URL with no
// Postgres behind it.

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("en") }));

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ admin: { id: "admin-1" } }),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

type FakeProvider = {
  id: string;
  userId: string;
  businessName: unknown;
  businessDescription: unknown;
  slug: string | null;
  status: string;
  visible: boolean;
  contactEmail: string | null;
  city: string | null;
  logoUrl: string | null;
  approvedAt: Date | null;
  approvedByAdminId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

let store: Map<string, FakeProvider>;
let users: Set<string>;
let nextId: number;

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => (users.has(where.id) ? { id: where.id } : null),
    },
    provider: {
      findUnique: async ({ where }: { where: { id?: string; userId?: string; slug?: string } }) => {
        if (where.id) return store.get(where.id) ?? null;
        if (where.userId) return [...store.values()].find((p) => p.userId === where.userId) ?? null;
        if (where.slug) return [...store.values()].find((p) => p.slug === where.slug) ?? null;
        return null;
      },
      count: async () => store.size,
      findMany: async () => [...store.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    },
    auditLog: { create: async () => ({}) },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        provider: {
          create: async (args: {
            data: {
              userId: string;
              businessName: unknown;
              businessDescription?: unknown;
              slug?: string;
              contactEmail?: string;
              city?: string;
              logoUrl?: string;
            };
          }) => {
            const provider: FakeProvider = {
              id: `019f4e4e-8116-7052-b15e-${String(nextId++).padStart(12, "0")}`,
              userId: args.data.userId,
              businessName: args.data.businessName,
              businessDescription: args.data.businessDescription ?? null,
              slug: args.data.slug ?? null,
              status: "APPLIED",
              visible: true,
              contactEmail: args.data.contactEmail ?? null,
              city: args.data.city ?? null,
              logoUrl: args.data.logoUrl ?? null,
              approvedAt: null,
              approvedByAdminId: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            store.set(provider.id, provider);
            return provider;
          },
          update: async (args: { where: { id: string }; data: Partial<FakeProvider> }) => {
            const existing = store.get(args.where.id);
            if (!existing) throw new Error("not found");
            const updated = { ...existing, ...args.data };
            store.set(args.where.id, updated as FakeProvider);
            return updated;
          },
        },
        auditLog: { create: async () => ({}) },
      }),
  },
}));

const { createProvider } = await import("./create-provider");
const { publishProvider, unpublishProvider } = await import("./toggle-provider-visibility");
const { archiveProvider } = await import("./archive-provider");
const { getProviders } = await import("./get-providers");

const USER_ID = "019f8ee1-d869-78d3-9a56-f86a70006365";

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

function baseFields(overrides: Record<string, string> = {}) {
  return {
    userId: USER_ID,
    nameAr: "شركة الرحلات",
    nameEn: "Trips Co",
    descriptionAr: "",
    descriptionEn: "",
    slug: "trips-co",
    contactEmail: "",
    city: "",
    logoUrl: "",
    ...overrides,
  };
}

beforeEach(() => {
  store = new Map();
  users = new Set([USER_ID]);
  nextId = 1;
});

describe("Provider domain integration (create -> publish/unpublish -> archive -> query)", () => {
  it("a freshly created provider is APPLIED and not publishable yet (BR-001)", async () => {
    const created = await createProvider(buildFormData(baseFields()));
    expect(created).toEqual({ ok: true, providerId: expect.any(String) });
    if (!created.ok) throw new Error("setup failed");

    const publishAttempt = await publishProvider(created.providerId);
    expect(publishAttempt).toEqual({ ok: false, error: "PROVIDER_NOT_APPROVED" });

    const list = await getProviders();
    expect(list.items).toEqual([expect.objectContaining({ businessName: "Trips Co", status: "APPLIED" })]);
  });

  it("an APPROVED provider can be published then unpublished", async () => {
    const created = await createProvider(buildFormData(baseFields()));
    if (!created.ok) throw new Error("setup failed");

    // Directly promote to APPROVED in the fake store — approveProvider()
    // itself is Phase 4.1's existing, untouched module, not re-tested here.
    const provider = store.get(created.providerId);
    if (provider) store.set(created.providerId, { ...provider, status: "APPROVED" });

    const published = await publishProvider(created.providerId);
    expect(published).toEqual({ ok: true });
    expect(store.get(created.providerId)?.visible).toBe(true);

    const unpublished = await unpublishProvider(created.providerId);
    expect(unpublished).toEqual({ ok: true });
    expect(store.get(created.providerId)?.visible).toBe(false);
  });

  it("archiving is terminal — a second archive attempt refuses", async () => {
    const created = await createProvider(buildFormData(baseFields()));
    if (!created.ok) throw new Error("setup failed");

    const archived = await archiveProvider(created.providerId);
    expect(archived).toEqual({ ok: true });
    expect(store.get(created.providerId)?.status).toBe("DEACTIVATED");

    const secondAttempt = await archiveProvider(created.providerId);
    expect(secondAttempt).toEqual({ ok: false, error: "INVALID_STATUS_TRANSITION" });
  });

  it("refuses to create two providers with the same slug", async () => {
    const first = await createProvider(buildFormData(baseFields()));
    expect(first.ok).toBe(true);

    users.add("019f8ee1-d869-78d3-9a56-f86a70006366");
    const second = await createProvider(
      buildFormData(baseFields({ userId: "019f8ee1-d869-78d3-9a56-f86a70006366" }))
    );
    expect(second).toEqual({ ok: false, error: "SLUG_TAKEN" });

    const list = await getProviders();
    expect(list.items).toHaveLength(1);
  });

  it("refuses to create a second provider for the same user", async () => {
    const first = await createProvider(buildFormData(baseFields()));
    expect(first.ok).toBe(true);

    const second = await createProvider(buildFormData(baseFields({ slug: "trips-co-2" })));
    expect(second).toEqual({ ok: false, error: "USER_ALREADY_HAS_PROVIDER_PROFILE" });
  });
});
