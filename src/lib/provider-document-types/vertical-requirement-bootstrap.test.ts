import { describe, it, expect } from "vitest";
import {
  runVerticalRequirementBootstrap,
  type RequirementRow,
  type VerificationRequirementBootstrapPrisma,
} from "./verification-requirement-bootstrap";
import { VERTICAL_VERIFICATION_REQUIREMENTS } from "./default-requirements";

// Phase 3B — Phase 1. Idempotent bootstrap for the provider-VERTICAL requirement policy. In-memory
// fake Prisma surface (no DB), same style as the default-policy bootstrap test.

type Stored = RequirementRow & Record<string, unknown>;

function makeFakeClient(seed: Stored[] = []) {
  const byKey = new Map<string, Stored>();
  for (const r of seed) byKey.set(r.key, { ...r });
  let idCounter = byKey.size;
  const createCalls: Record<string, unknown>[] = [];
  const client: VerificationRequirementBootstrapPrisma = {
    providerVerificationRequirement: {
      async findUnique({ where: { key } }) {
        return byKey.get(key) ?? null;
      },
      async create({ data }) {
        createCalls.push(data as unknown as Record<string, unknown>);
        idCounter += 1;
        const row: Stored = { id: `req-${idCounter}`, ...(data as unknown as Record<string, unknown>) } as Stored;
        byKey.set(data.key, row);
        return row;
      },
    },
  };
  return { client, byKey, createCalls };
}

describe("runVerticalRequirementBootstrap", () => {
  it("seeds exactly the vertical requirements with the right audiences + evidenceExpires (apply, empty DB)", async () => {
    const { client, byKey, createCalls } = makeFakeClient();
    const report = await runVerticalRequirementBootstrap(client, { apply: true });

    expect(report.applied).toBe(true);
    expect(report.requirements.every((r) => r.action === "created")).toBe(true);
    // The exact seeded keys.
    expect(createCalls.map((c) => c.key).sort()).toEqual([
      "RENTAL_ACTIVITY_LICENCE",
      "RENTAL_BUSINESS_REGISTRATION",
      "TOURIST_GUIDE_LICENCE",
    ]);
    // All required, active, evidence-expiring, and on the vertical audiences (never a form audience).
    for (const c of createCalls) {
      expect(c.required).toBe(true);
      expect(c.active).toBe(true);
      expect(c.evidenceExpires).toBe(true);
      expect(["RENTAL_COMPANY", "TOURIST_GUIDE"]).toContain(c.appliesTo);
    }
    expect(byKey.get("TOURIST_GUIDE_LICENCE")?.appliesTo).toBe("TOURIST_GUIDE");
  });

  it("DRY-RUN writes nothing", async () => {
    const { client, byKey, createCalls } = makeFakeClient();
    const report = await runVerticalRequirementBootstrap(client, { apply: false });
    expect(report.applied).toBe(false);
    expect(createCalls).toHaveLength(0);
    expect(byKey.size).toBe(0);
  });

  it("is IDEMPOTENT: a second apply creates nothing more and never overwrites an admin-edited row", async () => {
    const { client, createCalls } = makeFakeClient();
    await runVerticalRequirementBootstrap(client, { apply: true });
    const afterFirst = createCalls.length;
    expect(afterFirst).toBe(VERTICAL_VERIFICATION_REQUIREMENTS.length);

    // Second run — every row now "exists"; no further creates.
    const report2 = await runVerticalRequirementBootstrap(client, { apply: true });
    expect(createCalls.length).toBe(afterFirst); // unchanged
    expect(report2.requirements.every((r) => r.action === "exists")).toBe(true);
  });

  it("preserves an admin-edited existing row (insert-if-absent, never overwrite)", async () => {
    const { client, byKey, createCalls } = makeFakeClient([
      { id: "admin-1", key: "TOURIST_GUIDE_LICENCE", required: false, active: false, appliesTo: "TOURIST_GUIDE" },
    ]);
    await runVerticalRequirementBootstrap(client, { apply: true });
    // The admin's row is untouched…
    expect(byKey.get("TOURIST_GUIDE_LICENCE")).toMatchObject({ id: "admin-1", required: false, active: false });
    // …and only the two rental requirements were created.
    expect(createCalls.map((c) => c.key).sort()).toEqual(["RENTAL_ACTIVITY_LICENCE", "RENTAL_BUSINESS_REGISTRATION"]);
  });
});
