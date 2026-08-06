import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 2.3 (Service Foundation) — integration test composing
// createService() -> publishService()/unpublishService() ->
// archiveService() -> getServices() across real, unmocked
// business-logic modules against an in-memory fake Prisma store. Same
// rationale as provider-domain.integration.test.ts: every existing test
// in this codebase mocks @/lib/db rather than connecting to a real
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

vi.mock("@/lib/services/service-status-policy", async () => {
  const actual = await vi.importActual("@/lib/services/service-status-policy");
  return actual;
});

type FakeService = {
  id: string;
  providerId: string;
  serviceType: string;
  categoryId: string | null;
  name: unknown;
  description: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

type FakePrice = {
  id: string;
  serviceId: string;
  amount: string;
  currency: string;
  status: string;
};

let store: Map<string, FakeService>;
let prices: FakePrice[];
let providers: Map<string, { id: string; businessName: unknown }>;
let nextId: number;

vi.mock("@/lib/db", () => ({
  prisma: {
    provider: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        providers.get(where.id) ?? null,
    },
    service: {
      findUnique: async ({ where }: { where: { id: string } }) => store.get(where.id) ?? null,
      count: async () => store.size,
      findMany: async () =>
        [...store.values()]
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((service) => ({
            ...service,
            provider: providers.get(service.providerId) ?? { businessName: null },
            prices: prices.filter((p) => p.serviceId === service.id && p.status === "ACTIVE"),
          })),
    },
    price: {
      findFirst: async ({ where }: { where: { serviceId: string; status: string } }) =>
        prices.find((p) => p.serviceId === where.serviceId && p.status === where.status) ?? null,
    },
    // Any well-formed categoryId resolves to a selectable PUBLIC/EXPERIENCE
    // category — the tests only ever pass CATEGORY_ID (a valid uuid); an invalid
    // uuid is rejected upstream by assertAssignableCategory before this runs.
    category: {
      findFirst: async () => ({ visibilityStatus: "PUBLIC", serviceTypeKey: "EXPERIENCE", parent: null }),
    },
    auditLog: { create: async () => ({}) },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        service: {
          create: async (args: { data: { providerId: string; serviceType: string; categoryId?: string | null; name: unknown; description?: unknown } }) => {
            const service: FakeService = {
              id: `019f4e4e-8116-7052-b15e-${String(nextId++).padStart(12, "0")}`,
              providerId: args.data.providerId,
              serviceType: args.data.serviceType,
              categoryId: args.data.categoryId ?? null,
              name: args.data.name,
              description: args.data.description ?? null,
              status: "DRAFT",
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            store.set(service.id, service);
            return service;
          },
          update: async (args: { where: { id: string }; data: Partial<FakeService> }) => {
            const existing = store.get(args.where.id);
            if (!existing) throw new Error("not found");
            const updated = { ...existing, ...args.data };
            store.set(args.where.id, updated);
            return updated;
          },
        },
        auditLog: { create: async () => ({}) },
      }),
  },
}));

const { createService } = await import("./create-service");
const { publishService, unpublishService, archiveService } = await import("./transition-service-status");
const { getServices } = await import("./get-services");

const PROVIDER_ID = "019f8ee1-d869-78d3-9a56-f86a70006365";
const CATEGORY_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

function baseFields(overrides: Record<string, string> = {}) {
  return {
    providerId: PROVIDER_ID,
    nameAr: "جولة الصحراء",
    nameEn: "Desert Tour",
    descriptionAr: "",
    descriptionEn: "",
    ...overrides,
  };
}

beforeEach(() => {
  store = new Map();
  prices = [];
  providers = new Map([[PROVIDER_ID, { id: PROVIDER_ID, businessName: { ar: "شركة", en: "Trips Co" } }]]);
  nextId = 1;
});

describe("Service domain integration (create -> publish/unpublish -> archive -> query)", () => {
  it("a freshly created, categorized service is DRAFT and not publishable without an ACTIVE price", async () => {
    const created = await createService(buildFormData(baseFields({ categoryId: CATEGORY_ID })));
    expect(created).toEqual({ ok: true, serviceId: expect.any(String) });
    if (!created.ok) throw new Error("setup failed");

    const publishAttempt = await publishService(created.serviceId);
    expect(publishAttempt).toEqual({ ok: false, error: "NO_ACTIVE_PRICE", blockers: ["NO_ACTIVE_PRICE"] });

    const list = await getServices();
    expect(list.items).toEqual([expect.objectContaining({ name: "Desert Tour", status: "DRAFT" })]);
  });

  it("an uncategorized service cannot be published even with an ACTIVE price (BR-026)", async () => {
    const created = await createService(buildFormData(baseFields()));
    if (!created.ok) throw new Error("setup failed");

    prices.push({ id: "price-x", serviceId: created.serviceId, amount: "25.00", currency: "OMR", status: "ACTIVE" });

    const publishAttempt = await publishService(created.serviceId);
    expect(publishAttempt).toEqual({ ok: false, error: "SERVICE_CATEGORY_REQUIRED", blockers: ["SERVICE_CATEGORY_REQUIRED"] });
    expect(store.get(created.serviceId)?.status).toBe("DRAFT");
  });

  it("a categorized service with an ACTIVE price can be published then unpublished", async () => {
    const created = await createService(buildFormData(baseFields({ categoryId: CATEGORY_ID })));
    if (!created.ok) throw new Error("setup failed");

    prices.push({ id: "price-1", serviceId: created.serviceId, amount: "25.00", currency: "OMR", status: "ACTIVE" });

    const published = await publishService(created.serviceId);
    expect(published).toEqual({ ok: true });
    expect(store.get(created.serviceId)?.status).toBe("PUBLISHED");

    const unpublished = await unpublishService(created.serviceId);
    expect(unpublished).toEqual({ ok: true });
    expect(store.get(created.serviceId)?.status).toBe("PAUSED");
  });

  it("archiving is terminal — a second archive attempt refuses", async () => {
    const created = await createService(buildFormData(baseFields()));
    if (!created.ok) throw new Error("setup failed");

    const archived = await archiveService(created.serviceId);
    expect(archived).toEqual({ ok: true });
    expect(store.get(created.serviceId)?.status).toBe("ARCHIVED");

    const secondAttempt = await archiveService(created.serviceId);
    expect(secondAttempt).toEqual({ ok: false, error: "INVALID_STATUS_TRANSITION" });
  });

  it("refuses to create a service for a nonexistent provider", async () => {
    const result = await createService(
      buildFormData(baseFields({ providerId: "019f8ee1-d869-78d3-9a56-f86a70009999" }))
    );

    expect(result).toEqual({ ok: false, error: "PROVIDER_NOT_FOUND" });

    const list = await getServices();
    expect(list.items).toHaveLength(0);
  });
});
