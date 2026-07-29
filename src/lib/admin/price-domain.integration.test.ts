import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 2.5 (Pricing Foundation) — integration test composing
// createPrice() -> updatePrice() -> deactivatePrice() -> getPrices()
// across real, unmocked business-logic modules against an in-memory
// fake Prisma store. Same rationale as service-domain.integration.test.ts:
// every existing test in this codebase mocks @/lib/db rather than
// connecting to a real database, and CI runs against a placeholder
// DATABASE_URL with no Postgres behind it.

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("en") }));

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ admin: { id: "admin-1" } }),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

type FakePrice = {
  id: string;
  serviceId: string;
  amount: string;
  currency: string;
  status: string;
  createdAt: Date;
};

let store: Map<string, FakePrice>;
let services: Map<string, { id: string; name: unknown }>;
let nextId: number;

vi.mock("@/lib/db", () => ({
  prisma: {
    service: {
      findUnique: async ({ where }: { where: { id: string } }) => services.get(where.id) ?? null,
    },
    price: {
      findUnique: async ({ where }: { where: { id: string } }) => store.get(where.id) ?? null,
      findFirst: async ({ where }: { where: { serviceId: string; status: string } }) =>
        [...store.values()].find((p) => p.serviceId === where.serviceId && p.status === where.status) ?? null,
      count: async () => store.size,
      findMany: async () =>
        [...store.values()]
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((price) => ({ ...price, service: services.get(price.serviceId) ?? { name: null } })),
    },
    auditLog: { create: async () => ({}) },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        price: {
          create: async (args: { data: { serviceId: string; amount: string; currency: string } }) => {
            const price: FakePrice = {
              id: `019f4e4e-8116-7052-b15e-${String(nextId++).padStart(12, "0")}`,
              serviceId: args.data.serviceId,
              amount: args.data.amount,
              currency: args.data.currency,
              status: "ACTIVE",
              createdAt: new Date(),
            };
            store.set(price.id, price);
            return price;
          },
          update: async (args: { where: { id: string }; data: Partial<FakePrice> }) => {
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

const { createPrice } = await import("./create-price");
const { updatePrice } = await import("./update-price");
const { deactivatePrice } = await import("./deactivate-price");
const { getPrices } = await import("./get-prices");

const SERVICE_ID = "019f8ee1-d869-78d3-9a56-f86a70006365";

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

beforeEach(() => {
  store = new Map();
  services = new Map([[SERVICE_ID, { id: SERVICE_ID, name: { ar: "جولة", en: "Desert Tour" } }]]);
  nextId = 1;
});

describe("Price domain integration (create -> update -> deactivate -> query)", () => {
  it("creates the first price ACTIVE and refuses a second create while one is active", async () => {
    const created = await createPrice(buildFormData({ serviceId: SERVICE_ID, amount: "20.00" }));
    expect(created).toEqual({ ok: true, priceId: expect.any(String) });
    if (!created.ok) throw new Error("setup failed");

    expect(store.get(created.priceId)?.status).toBe("ACTIVE");

    const secondCreate = await createPrice(buildFormData({ serviceId: SERVICE_ID, amount: "30.00" }));
    expect(secondCreate).toEqual({ ok: false, error: "PRICE_ALREADY_ACTIVE" });

    const list = await getPrices();
    expect(list.items).toHaveLength(1);
  });

  it("updating supersedes the old price and only one ACTIVE price exists afterward", async () => {
    const created = await createPrice(buildFormData({ serviceId: SERVICE_ID, amount: "20.00" }));
    if (!created.ok) throw new Error("setup failed");

    const updated = await updatePrice(SERVICE_ID, buildFormData({ amount: "35.00" }));
    expect(updated).toEqual({ ok: true, priceId: expect.any(String) });
    if (!updated.ok) throw new Error("update failed");

    expect(store.get(created.priceId)?.status).toBe("SUPERSEDED");
    expect(store.get(updated.priceId)?.status).toBe("ACTIVE");
    expect(store.get(updated.priceId)?.amount).toBe("35.00");

    const activeCount = [...store.values()].filter((p) => p.status === "ACTIVE").length;
    expect(activeCount).toBe(1);
  });

  it("deactivating leaves the service with zero ACTIVE prices", async () => {
    const created = await createPrice(buildFormData({ serviceId: SERVICE_ID, amount: "20.00" }));
    if (!created.ok) throw new Error("setup failed");

    const deactivated = await deactivatePrice(created.priceId);
    expect(deactivated).toEqual({ ok: true });
    expect(store.get(created.priceId)?.status).toBe("SUPERSEDED");

    const activeCount = [...store.values()].filter((p) => p.status === "ACTIVE").length;
    expect(activeCount).toBe(0);

    const secondDeactivate = await deactivatePrice(created.priceId);
    expect(secondDeactivate).toEqual({ ok: false, error: "NO_ACTIVE_PRICE" });
  });

  it("refuses to create a price for a nonexistent service", async () => {
    const result = await createPrice(
      buildFormData({ serviceId: "019f8ee1-d869-78d3-9a56-f86a70009999", amount: "20.00" })
    );

    expect(result).toEqual({ ok: false, error: "SERVICE_NOT_FOUND" });
  });
});
