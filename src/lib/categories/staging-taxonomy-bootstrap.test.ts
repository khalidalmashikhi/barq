import { describe, it, expect } from "vitest";
import {
  assertStagingEnvironment,
  assertStagingDatabaseTarget,
  StagingGuardError,
  StagingDatabaseTargetError,
  BARQ_STAGING_PROJECT_REF,
  runStagingTaxonomyBootstrap,
  validateTaxonomySpec,
  APPROVED_ROOTS,
  APPROVED_TOURS_CHILDREN,
  TOURS_PARENT_SLUG,
  JUNK_ROOT_SLUGS,
  type CategoryRow,
  type TaxonomyBootstrapPrisma,
} from "./staging-taxonomy-bootstrap";

// Staging taxonomy bootstrap (ADR-0016). Exercised against an in-memory fake
// Prisma surface so the full create/preserve/archive flow is proven with no DB.

type StoredCategory = CategoryRow & {
  name?: { ar: string; en: string };
  serviceTypeKey?: string;
  depth?: number;
  sortOrder?: number;
};

type UpsertCall = { slug: string; update: Record<string, never>; create: Record<string, unknown> };

function makeFakeClient(seed?: {
  categories?: StoredCategory[];
  serviceCountByCategoryId?: Record<string, number>;
  providerLinkCountByCategoryId?: Record<string, number>;
}) {
  const bySlug = new Map<string, StoredCategory>();
  for (const c of seed?.categories ?? []) bySlug.set(c.slug, { ...c });
  const serviceCounts = seed?.serviceCountByCategoryId ?? {};
  const providerLinkCounts = seed?.providerLinkCountByCategoryId ?? {};

  let idCounter = bySlug.size;
  const upsertCalls: UpsertCall[] = [];
  const updateCalls: Array<{ id: string; data: { visibilityStatus: "ARCHIVED" } }> = [];

  const client: TaxonomyBootstrapPrisma = {
    category: {
      async findUnique({ where: { slug } }) {
        return bySlug.get(slug) ?? null;
      },
      async upsert({ where: { slug }, update, create }) {
        upsertCalls.push({ slug, update, create: create as unknown as Record<string, unknown> });
        const existing = bySlug.get(slug);
        // INSERT-IF-ABSENT with empty update: an existing row is returned untouched.
        if (existing) return existing;
        idCounter += 1;
        const row: StoredCategory = {
          id: `cat-${idCounter}`,
          slug,
          visibilityStatus: create.visibilityStatus,
          parentId: create.parentId,
          name: create.name,
          serviceTypeKey: create.serviceTypeKey,
          depth: create.depth,
          sortOrder: create.sortOrder,
        };
        bySlug.set(slug, row);
        return row;
      },
      async update({ where: { id }, data }) {
        updateCalls.push({ id, data });
        const row = [...bySlug.values()].find((c) => c.id === id);
        if (!row) throw new Error(`fake update: no category id ${id}`);
        row.visibilityStatus = data.visibilityStatus;
        return row;
      },
      async count({ where: { parentId } }) {
        return [...bySlug.values()].filter((c) => c.parentId === parentId).length;
      },
    },
    service: {
      async count({ where: { categoryId } }) {
        return serviceCounts[categoryId] ?? 0;
      },
    },
    providerCategory: {
      async count({ where: { categoryId } }) {
        return providerLinkCounts[categoryId] ?? 0;
      },
    },
  };

  return { client, bySlug, upsertCalls, updateCalls };
}

describe("assertStagingEnvironment", () => {
  it("passes only for exactly 'staging'", () => {
    expect(() => assertStagingEnvironment("staging")).not.toThrow();
  });

  it("refuses production", () => {
    expect(() => assertStagingEnvironment("production")).toThrow(StagingGuardError);
  });

  it("refuses unset, local, and development", () => {
    expect(() => assertStagingEnvironment(undefined)).toThrow(StagingGuardError);
    expect(() => assertStagingEnvironment("local")).toThrow(StagingGuardError);
    expect(() => assertStagingEnvironment("development")).toThrow(StagingGuardError);
  });
});

describe("assertStagingDatabaseTarget", () => {
  const ref = BARQ_STAGING_PROJECT_REF;
  const goodTxPooler = `postgresql://postgres.${ref}:pw@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1`;

  it("1. rejects a missing/empty URL", () => {
    expect(() => assertStagingDatabaseTarget(undefined)).toThrow(StagingDatabaseTargetError);
    expect(() => assertStagingDatabaseTarget("")).toThrow(StagingDatabaseTargetError);
    expect(() => assertStagingDatabaseTarget("   ")).toThrow(StagingDatabaseTargetError);
  });

  it("2. rejects a malformed URL", () => {
    expect(() => assertStagingDatabaseTarget("not a url")).toThrow(StagingDatabaseTargetError);
    expect(() => assertStagingDatabaseTarget("::::")).toThrow(StagingDatabaseTargetError);
  });

  it("3. rejects localhost", () => {
    expect(() => assertStagingDatabaseTarget("postgresql://postgres:pw@localhost:5432/postgres")).toThrow(
      StagingDatabaseTargetError
    );
  });

  it("4. rejects 127.0.0.1", () => {
    expect(() => assertStagingDatabaseTarget("postgresql://postgres:pw@127.0.0.1:5432/postgres")).toThrow(
      StagingDatabaseTargetError
    );
  });

  it("5. rejects a normal external Postgres host", () => {
    expect(() => assertStagingDatabaseTarget("postgresql://user:pw@db.example.com:5432/app")).toThrow(
      StagingDatabaseTargetError
    );
  });

  it("6. rejects a Supabase pooler for a DIFFERENT project", () => {
    expect(() =>
      assertStagingDatabaseTarget("postgresql://postgres.someotherprojectref:pw@aws-1-ap-south-1.pooler.supabase.com:6543/postgres")
    ).toThrow(StagingDatabaseTargetError);
  });

  it("7. accepts the correct BARQ staging transaction-pooler URL", () => {
    expect(() => assertStagingDatabaseTarget(goodTxPooler)).not.toThrow();
  });

  it("8. accepts the correct staging URL regardless of aws-0/aws-1/region prefix", () => {
    for (const host of [
      `aws-0-ap-south-1.pooler.supabase.com`,
      `aws-1-ap-south-1.pooler.supabase.com`,
      `aws-9-eu-west-2.pooler.supabase.com`,
    ]) {
      expect(() =>
        assertStagingDatabaseTarget(`postgresql://postgres.${ref}:pw@${host}:5432/postgres`)
      ).not.toThrow();
    }
  });

  it("9. never includes password or query-string contents in a thrown error", () => {
    const secret = "SuperSecretPw123";
    const query = "pgbouncerSENTINEL=true";
    // Wrong-project URL that still carries a password + query string.
    const url = `postgresql://postgres.otherref:${secret}@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?${query}`;
    try {
      assertStagingDatabaseTarget(url);
      throw new Error("expected assertStagingDatabaseTarget to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(StagingDatabaseTargetError);
      const message = (error as Error).message;
      expect(message).not.toContain(secret);
      expect(message).not.toContain("SENTINEL");
      expect(message).not.toContain("otherref");
    }
  });
});

describe("validateTaxonomySpec", () => {
  it("accepts the approved spec (valid slugs, serviceTypeKeys, depth, no collisions)", () => {
    expect(() => validateTaxonomySpec()).not.toThrow();
  });
});

describe("runStagingTaxonomyBootstrap — apply on an empty DB", () => {
  it("creates exactly the 4 roots + 4 children with correct slugs, parent, labels, serviceTypeKey, PUBLIC", async () => {
    const { client, bySlug } = makeFakeClient();

    const report = await runStagingTaxonomyBootstrap(client, { apply: true });

    // 4 roots, all created.
    expect(report.roots.map((r) => r.slug)).toEqual(["cars", "tours-experiences", "marine-trips", "transfers"]);
    expect(report.roots.every((r) => r.action === "created" && r.id)).toBe(true);

    // serviceTypeKey mapping + PUBLIC + depth 0 for roots.
    const cars = bySlug.get("cars")!;
    expect(cars.serviceTypeKey).toBe("RENTAL");
    expect(cars.visibilityStatus).toBe("PUBLIC");
    expect(cars.depth).toBe(0);
    expect(cars.parentId).toBeNull();
    expect(cars.name).toEqual({ ar: "سيارات للإيجار", en: "Car Rentals" });
    expect(bySlug.get("transfers")!.serviceTypeKey).toBe("TRANSPORT");
    expect(bySlug.get("marine-trips")!.serviceTypeKey).toBe("EXPERIENCE");

    // 4 children, all created, all parented to tours-experiences, EXPERIENCE, depth 1.
    const parent = bySlug.get(TOURS_PARENT_SLUG)!;
    expect(report.children.map((c) => c.slug)).toEqual([
      "tourist-guides",
      "adventures",
      "local-experiences",
      "cultural-tours",
    ]);
    for (const child of APPROVED_TOURS_CHILDREN) {
      const row = bySlug.get(child.slug)!;
      expect(row.parentId).toBe(parent.id);
      expect(row.serviceTypeKey).toBe("EXPERIENCE");
      expect(row.depth).toBe(1);
      expect(row.visibilityStatus).toBe("PUBLIC");
      expect(row.name).toEqual({ ar: child.ar, en: child.en });
    }

    // Total rows created = 8.
    expect(bySlug.size).toBe(APPROVED_ROOTS.length + APPROVED_TOURS_CHILDREN.length);
  });
});

describe("runStagingTaxonomyBootstrap — idempotency & preservation", () => {
  it("is safely re-runnable: a second apply creates nothing and reports all 'exists'", async () => {
    const { client, bySlug } = makeFakeClient();
    await runStagingTaxonomyBootstrap(client, { apply: true });
    const sizeAfterFirst = bySlug.size;

    const second = await runStagingTaxonomyBootstrap(client, { apply: true });

    expect(bySlug.size).toBe(sizeAfterFirst); // no duplicates
    expect(second.roots.every((r) => r.action === "exists")).toBe(true);
    expect(second.children.every((c) => c.action === "exists")).toBe(true);
  });

  it("upserts with an EMPTY update — never overwrites an admin-edited existing category", async () => {
    // 'cars' pre-exists and an admin has HIDDEN it. Bootstrap must preserve that.
    const { client, bySlug, upsertCalls, updateCalls } = makeFakeClient({
      categories: [{ id: "admin-cars", slug: "cars", visibilityStatus: "HIDDEN", parentId: null }],
    });

    const report = await runStagingTaxonomyBootstrap(client, { apply: true });

    expect(report.roots.find((r) => r.slug === "cars")!.action).toBe("exists");
    expect(bySlug.get("cars")!.visibilityStatus).toBe("HIDDEN"); // preserved, not forced PUBLIC
    // Every upsert this run carried an empty update object (never an overwrite).
    expect(upsertCalls.every((c) => Object.keys(c.update).length === 0)).toBe(true);
    // No visibility update was issued against the pre-existing admin row.
    expect(updateCalls.some((u) => u.id === "admin-cars")).toBe(false);
  });

  it("dry-run writes nothing (no upsert, no update) and reports the plan", async () => {
    const { client, bySlug, upsertCalls, updateCalls } = makeFakeClient();

    const report = await runStagingTaxonomyBootstrap(client, { apply: false });

    expect(upsertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
    expect(bySlug.size).toBe(0);
    expect(report.applied).toBe(false);
    expect(report.roots.every((r) => r.action === "created" && r.id === null)).toBe(true);
  });
});

describe("runStagingTaxonomyBootstrap — junk archive safety", () => {
  it("archives a junk category (slug '1') only when it has zero dependencies", async () => {
    const { client, bySlug } = makeFakeClient({
      categories: [{ id: "junk-1", slug: "1", visibilityStatus: "PUBLIC", parentId: null }],
    });

    const report = await runStagingTaxonomyBootstrap(client, { apply: true });

    const outcome = report.junk.find((j) => j.slug === "1")!;
    expect(outcome.action).toBe("archived");
    expect(bySlug.get("1")!.visibilityStatus).toBe("ARCHIVED"); // never hard-deleted
    expect(bySlug.has("1")).toBe(true);
  });

  it("does NOT archive a junk category that has a Service dependency", async () => {
    const { client, bySlug } = makeFakeClient({
      categories: [{ id: "junk-2", slug: "2", visibilityStatus: "PUBLIC", parentId: null }],
      serviceCountByCategoryId: { "junk-2": 1 },
    });

    const report = await runStagingTaxonomyBootstrap(client, { apply: true });

    const outcome = report.junk.find((j) => j.slug === "2")!;
    expect(outcome.action).toBe("blocked");
    expect(outcome.deps).toEqual({ services: 1, providerLinks: 0, children: 0 });
    expect(bySlug.get("2")!.visibilityStatus).toBe("PUBLIC"); // untouched
  });

  it("does NOT archive a junk category that has a meaningful ProviderCategory dependency", async () => {
    const { client, bySlug } = makeFakeClient({
      categories: [{ id: "junk-1", slug: "1", visibilityStatus: "PUBLIC", parentId: null }],
      providerLinkCountByCategoryId: { "junk-1": 3 },
    });

    const report = await runStagingTaxonomyBootstrap(client, { apply: true });

    const outcome = report.junk.find((j) => j.slug === "1")!;
    expect(outcome.action).toBe("blocked");
    expect(outcome.deps).toEqual({ services: 0, providerLinks: 3, children: 0 });
    expect(bySlug.get("1")!.visibilityStatus).toBe("PUBLIC");
  });

  it("does NOT archive a junk category that has child categories", async () => {
    const { client, bySlug } = makeFakeClient({
      categories: [
        { id: "junk-1", slug: "1", visibilityStatus: "PUBLIC", parentId: null },
        { id: "junk-1-child", slug: "1-child", visibilityStatus: "PUBLIC", parentId: "junk-1" },
      ],
    });

    const report = await runStagingTaxonomyBootstrap(client, { apply: true });

    const outcome = report.junk.find((j) => j.slug === "1")!;
    expect(outcome.action).toBe("blocked");
    expect(outcome.deps).toEqual({ services: 0, providerLinks: 0, children: 1 });
    expect(bySlug.get("1")!.visibilityStatus).toBe("PUBLIC");
  });

  it("reports 'absent' for junk slugs that do not exist, and is a no-op for them", async () => {
    const { client } = makeFakeClient();

    const report = await runStagingTaxonomyBootstrap(client, { apply: true });

    expect(report.junk.map((j) => j.slug)).toEqual([...JUNK_ROOT_SLUGS]);
    expect(report.junk.every((j) => j.action === "absent")).toBe(true);
  });

  it("is idempotent on archive: an already-ARCHIVED junk category is left as-is", async () => {
    const { client, updateCalls } = makeFakeClient({
      categories: [{ id: "junk-1", slug: "1", visibilityStatus: "ARCHIVED", parentId: null }],
    });

    const report = await runStagingTaxonomyBootstrap(client, { apply: true });

    expect(report.junk.find((j) => j.slug === "1")!.action).toBe("already-archived");
    expect(updateCalls).toHaveLength(0); // no redundant write
  });
});
