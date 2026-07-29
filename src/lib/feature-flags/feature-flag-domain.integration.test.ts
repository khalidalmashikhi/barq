import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 1.3 (Core Business Platform) — integration test for the Feature
// Flag domain, composing create -> toggle -> query across real, unmocked
// business-logic modules against an in-memory fake Prisma store. Same
// rationale as category-domain.integration.test.ts: every existing test
// in this codebase mocks @/lib/db rather than connecting to a real
// database, and CI runs against a placeholder DATABASE_URL with no
// Postgres behind it — this stays consistent with that convention while
// still exercising real composition across createFeatureFlag(),
// enableFeatureFlag()/disableFeatureFlag(), getFeatureFlags(), and
// isFeatureEnabled() together, unmocked.

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ admin: { id: "admin-1" } }),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

type FakeFlag = {
  id: string;
  key: string;
  enabled: boolean;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

let store: Map<string, FakeFlag>;
let nextId: number;

vi.mock("@/lib/db", () => ({
  prisma: {
    featureFlag: {
      findUnique: async ({ where, select }: { where: { id?: string; key?: string }; select?: { enabled?: boolean } }) => {
        const flag = where.id ? store.get(where.id) : [...store.values()].find((f) => f.key === where.key);
        if (!flag) return null;
        if (select?.enabled) return { enabled: flag.enabled };
        return flag;
      },
      count: async () => store.size,
      findMany: async () => [...store.values()],
    },
    auditLog: { create: async () => ({}) },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        featureFlag: {
          create: async (args: { data: { key: string; description: string | null } }) => {
            const flag: FakeFlag = {
              id: `019f4e4e-8116-7052-b15e-${String(nextId++).padStart(12, "0")}`,
              key: args.data.key,
              enabled: false,
              description: args.data.description,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            store.set(flag.id, flag);
            return flag;
          },
          update: async (args: { where: { id: string }; data: Partial<FakeFlag> }) => {
            const existing = store.get(args.where.id);
            if (!existing) throw new Error("not found");
            const updated = { ...existing, ...args.data };
            store.set(args.where.id, updated as FakeFlag);
            return updated;
          },
        },
        auditLog: { create: async () => ({}) },
      }),
  },
}));

const { createFeatureFlag } = await import("./create-feature-flag");
const { enableFeatureFlag, disableFeatureFlag } = await import("./toggle-feature-flag");
const { getFeatureFlags } = await import("./get-feature-flags");
const { isFeatureEnabled } = await import("./is-feature-enabled");

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

describe("Feature Flag domain integration (create -> toggle -> query)", () => {
  it("a freshly created flag is disabled, and isFeatureEnabled() agrees", async () => {
    const created = await createFeatureFlag(buildFormData({ key: "new_checkout_flow", description: "" }));
    expect(created).toEqual({ ok: true, flagId: expect.any(String) });

    expect(await isFeatureEnabled("new_checkout_flow")).toBe(false);

    const list = await getFeatureFlags();
    expect(list.items).toEqual([expect.objectContaining({ key: "new_checkout_flow", enabled: false })]);
  });

  it("enabling then disabling a flag is reflected by both the list and isFeatureEnabled()", async () => {
    const created = await createFeatureFlag(buildFormData({ key: "new_checkout_flow", description: "" }));
    if (!created.ok) throw new Error("setup failed");

    const enabled = await enableFeatureFlag(created.flagId);
    expect(enabled).toEqual({ ok: true });
    expect(await isFeatureEnabled("new_checkout_flow")).toBe(true);

    const disabled = await disableFeatureFlag(created.flagId);
    expect(disabled).toEqual({ ok: true });
    expect(await isFeatureEnabled("new_checkout_flow")).toBe(false);
  });

  it("refuses to create two flags with the same key", async () => {
    const first = await createFeatureFlag(buildFormData({ key: "new_checkout_flow", description: "" }));
    expect(first.ok).toBe(true);

    const second = await createFeatureFlag(buildFormData({ key: "new_checkout_flow", description: "Different" }));
    expect(second).toEqual({ ok: false, error: "KEY_TAKEN" });

    const list = await getFeatureFlags();
    expect(list.items).toHaveLength(1);
  });

  it("isFeatureEnabled() returns false for a key that was never created", async () => {
    expect(await isFeatureEnabled("never_created")).toBe(false);
  });
});
