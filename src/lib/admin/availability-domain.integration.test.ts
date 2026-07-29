import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 2.7 (Availability Foundation) — integration test composing
// createAvailability() -> deactivateAvailability()/activateAvailability()
// -> updateAvailability() -> getAvailabilitySlots() across real,
// unmocked business-logic modules against an in-memory fake Prisma
// store. Same rationale as price-domain.integration.test.ts /
// service-domain.integration.test.ts: every existing test in this
// codebase mocks @/lib/db rather than connecting to a real database,
// and CI runs against a placeholder DATABASE_URL with no Postgres
// behind it.

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("en") }));

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ admin: { id: "admin-1" } }),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

type FakeSlot = {
  id: string;
  serviceId: string;
  startTime: Date;
  endTime: Date;
  capacity: number;
  bookedCount: number;
  state: string;
  createdAt: Date;
  updatedAt: Date;
};

let store: Map<string, FakeSlot>;
let services: Map<string, { id: string; name: unknown }>;
let nextId: number;

vi.mock("@/lib/db", () => ({
  prisma: {
    service: {
      findUnique: async ({ where }: { where: { id: string } }) => services.get(where.id) ?? null,
    },
    availability: {
      findUnique: async ({ where }: { where: { id: string } }) => store.get(where.id) ?? null,
      count: async () => store.size,
      findMany: async () =>
        [...store.values()]
          .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
          .map((slot) => ({ ...slot, service: services.get(slot.serviceId) ?? { name: null } })),
    },
    auditLog: { create: async () => ({}) },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        availability: {
          create: async (args: { data: { serviceId: string; startTime: Date; endTime: Date; capacity: number } }) => {
            const slot: FakeSlot = {
              id: `019f4e4e-8116-7052-b15e-${String(nextId++).padStart(12, "0")}`,
              serviceId: args.data.serviceId,
              startTime: args.data.startTime,
              endTime: args.data.endTime,
              capacity: args.data.capacity,
              bookedCount: 0,
              state: "OPEN",
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            store.set(slot.id, slot);
            return slot;
          },
          update: async (args: { where: { id: string }; data: Partial<FakeSlot> }) => {
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

const { createAvailability } = await import("./create-availability");
const { updateAvailability } = await import("./update-availability");
const { activateAvailability, deactivateAvailability } = await import("./transition-availability-state");
const { getAvailabilitySlots } = await import("./get-availability-slots");

const SERVICE_ID = "019f8ee1-d869-78d3-9a56-f86a70006365";

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

function baseFields(overrides: Record<string, string> = {}) {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    serviceId: SERVICE_ID,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    capacity: "5",
    ...overrides,
  };
}

beforeEach(() => {
  store = new Map();
  services = new Map([[SERVICE_ID, { id: SERVICE_ID, name: { ar: "جولة", en: "Desert Tour" } }]]);
  nextId = 1;
});

describe("Availability domain integration (create -> deactivate/activate -> update -> query)", () => {
  it("creates a slot OPEN with bookedCount 0", async () => {
    const created = await createAvailability(buildFormData(baseFields()));
    expect(created).toEqual({ ok: true, slotId: expect.any(String) });
    if (!created.ok) throw new Error("setup failed");

    expect(store.get(created.slotId)?.state).toBe("OPEN");
    expect(store.get(created.slotId)?.bookedCount).toBe(0);

    const list = await getAvailabilitySlots();
    expect(list.items).toEqual([expect.objectContaining({ serviceName: "Desert Tour", state: "OPEN" })]);
  });

  it("deactivating then activating round-trips OPEN -> BLOCKED -> OPEN", async () => {
    const created = await createAvailability(buildFormData(baseFields()));
    if (!created.ok) throw new Error("setup failed");

    const deactivated = await deactivateAvailability(created.slotId);
    expect(deactivated).toEqual({ ok: true });
    expect(store.get(created.slotId)?.state).toBe("BLOCKED");

    const secondDeactivate = await deactivateAvailability(created.slotId);
    expect(secondDeactivate).toEqual({ ok: false, error: "INVALID_STATE_TRANSITION" });

    const activated = await activateAvailability(created.slotId);
    expect(activated).toEqual({ ok: true });
    expect(store.get(created.slotId)?.state).toBe("OPEN");
  });

  it("updates capacity via updateAvailability without touching state", async () => {
    const created = await createAvailability(buildFormData(baseFields()));
    if (!created.ok) throw new Error("setup failed");

    const updated = await updateAvailability(created.slotId, buildFormData({ capacity: "12" }));
    expect(updated).toEqual({ ok: true });
    expect(store.get(created.slotId)?.capacity).toBe(12);
    expect(store.get(created.slotId)?.state).toBe("OPEN");
  });

  it("refuses to create a slot for a nonexistent service", async () => {
    const result = await createAvailability(
      buildFormData(baseFields({ serviceId: "019f8ee1-d869-78d3-9a56-f86a70009999" }))
    );

    expect(result).toEqual({ ok: false, error: "SERVICE_NOT_FOUND" });
  });
});
