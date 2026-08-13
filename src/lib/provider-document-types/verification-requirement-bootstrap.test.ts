import { describe, it, expect } from "vitest";
import {
  runVerificationRequirementBootstrap,
  type RequirementRow,
  type VerificationRequirementBootstrapPrisma,
} from "./verification-requirement-bootstrap";
import { DEFAULT_VERIFICATION_REQUIREMENTS } from "./default-requirements";

// ADR-0017 staging bootstrap (default verification policy). Exercised against an
// in-memory fake Prisma surface so the full create/preserve flow is proven with
// no DB — the same style as the ADR-0016 taxonomy bootstrap test.

type StoredRequirement = RequirementRow & {
  name?: { ar: string; en: string };
  description?: { ar: string; en: string };
  appliesTo?: string;
  required?: boolean;
  active?: boolean;
  sortOrder?: number;
};

type CreateCall = { data: Record<string, unknown> };

function makeFakeClient(seed?: { requirements?: StoredRequirement[] }) {
  const byKey = new Map<string, StoredRequirement>();
  for (const r of seed?.requirements ?? []) byKey.set(r.key, { ...r });

  let idCounter = byKey.size;
  const createCalls: CreateCall[] = [];

  const client: VerificationRequirementBootstrapPrisma = {
    providerVerificationRequirement: {
      async findUnique({ where: { key } }) {
        return byKey.get(key) ?? null;
      },
      async create({ data }) {
        createCalls.push({ data: data as unknown as Record<string, unknown> });
        idCounter += 1;
        const row: StoredRequirement = {
          id: `req-${idCounter}`,
          key: data.key,
          name: data.name,
          description: data.description,
          appliesTo: data.appliesTo,
          required: data.required,
          active: data.active,
          sortOrder: data.sortOrder,
        };
        byKey.set(data.key, row);
        return row;
      },
    },
  };

  return { client, byKey, createCalls };
}

describe("runVerificationRequirementBootstrap — apply on an empty DB", () => {
  it("creates exactly the three default requirements with correct mapping", async () => {
    const { client, byKey, createCalls } = makeFakeClient();

    const report = await runVerificationRequirementBootstrap(client, { apply: true });

    expect(report.applied).toBe(true);
    expect(report.requirements.map((r) => r.key)).toEqual([
      "IDENTITY_PROOF",
      "COMMERCIAL_REGISTRATION",
      "TOURISM_LICENCE",
    ]);
    expect(report.requirements.every((r) => r.action === "created" && r.id)).toBe(true);
    expect(createCalls).toHaveLength(3);
    expect(byKey.size).toBe(3);

    // Exact default mapping.
    const identity = byKey.get("IDENTITY_PROOF")!;
    expect(identity.appliesTo).toBe("INDIVIDUAL");
    expect(identity.required).toBe(true);
    expect(identity.active).toBe(true);
    expect(identity.name).toEqual({ ar: "إثبات الهوية", en: "Identity Proof" });

    const commercial = byKey.get("COMMERCIAL_REGISTRATION")!;
    expect(commercial.appliesTo).toBe("COMPANY");
    expect(commercial.required).toBe(true);
    expect(commercial.active).toBe(true);

    const tourism = byKey.get("TOURISM_LICENCE")!;
    expect(tourism.appliesTo).toBe("BOTH");
    expect(tourism.required).toBe(false); // optional
    expect(tourism.active).toBe(true);
  });

  it("seeds exactly what DEFAULT_VERIFICATION_REQUIREMENTS declares (single source)", async () => {
    const { client, byKey } = makeFakeClient();
    await runVerificationRequirementBootstrap(client, { apply: true });

    for (const def of DEFAULT_VERIFICATION_REQUIREMENTS) {
      const row = byKey.get(def.key)!;
      expect(row.appliesTo).toBe(def.appliesTo);
      expect(row.required).toBe(def.required);
      expect(row.active).toBe(def.active);
      expect(row.sortOrder).toBe(def.sortOrder);
      expect(row.name).toEqual(def.name);
      expect(row.description).toEqual(def.description);
    }
  });
});

describe("runVerificationRequirementBootstrap — dry-run", () => {
  it("writes nothing (no create) and reports the plan", async () => {
    const { client, byKey, createCalls } = makeFakeClient();

    const report = await runVerificationRequirementBootstrap(client, { apply: false });

    expect(createCalls).toHaveLength(0);
    expect(byKey.size).toBe(0);
    expect(report.applied).toBe(false);
    expect(report.requirements.every((r) => r.action === "created" && r.id === null)).toBe(true);
  });
});

describe("runVerificationRequirementBootstrap — idempotency & preservation", () => {
  it("is safely re-runnable: a second apply creates nothing and reports all 'exists'", async () => {
    const { client, byKey } = makeFakeClient();
    await runVerificationRequirementBootstrap(client, { apply: true });
    const sizeAfterFirst = byKey.size;

    const second = await runVerificationRequirementBootstrap(client, { apply: true });

    expect(byKey.size).toBe(sizeAfterFirst); // no duplicates
    expect(second.requirements.every((r) => r.action === "exists")).toBe(true);
  });

  it("insert-if-absent: never overwrites an admin-edited existing requirement", async () => {
    // An admin has already renamed IDENTITY_PROOF and made it optional. Bootstrap
    // must leave that row EXACTLY as-is (no create, no update).
    const { client, byKey, createCalls } = makeFakeClient({
      requirements: [
        {
          id: "admin-identity",
          key: "IDENTITY_PROOF",
          name: { ar: "هوية مُعدّلة", en: "Admin-edited Identity" },
          appliesTo: "BOTH",
          required: false,
          active: false,
          sortOrder: 9,
        },
      ],
    });

    const report = await runVerificationRequirementBootstrap(client, { apply: true });

    // The admin row is untouched.
    const identity = byKey.get("IDENTITY_PROOF")!;
    expect(identity.id).toBe("admin-identity");
    expect(identity.name).toEqual({ ar: "هوية مُعدّلة", en: "Admin-edited Identity" });
    expect(identity.appliesTo).toBe("BOTH");
    expect(identity.required).toBe(false);
    expect(identity.active).toBe(false);
    expect(report.requirements.find((r) => r.key === "IDENTITY_PROOF")!.action).toBe("exists");

    // Only the two ABSENT defaults were created; the admin row was not re-created.
    expect(createCalls.map((c) => c.data.key)).toEqual(["COMMERCIAL_REGISTRATION", "TOURISM_LICENCE"]);
  });
});
