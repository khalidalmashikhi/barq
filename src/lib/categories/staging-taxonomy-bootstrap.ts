// BARQ v1 marketplace taxonomy — STAGING bootstrap core (ADR-0016).
//
// Pure, dependency-injected core for the staging-only taxonomy bootstrap. It
// deliberately imports NO `server-only`, NO `@/lib/db`, and NO Next runtime —
// so the same logic runs under `tsx` (scripts/bootstrap-staging-taxonomy.ts)
// and under vitest with a mock client. The Prisma client is passed in.
//
// It reuses the SAME domain rules Admin Category Management enforces, rather
// than re-deriving them:
//   - serviceTypeKey validated against the code registry (isValidServiceTypeKey)
//   - slug shape validated against the exact pattern createCategory uses
//   - depth capped by MAX_CATEGORY_DEPTH (ADR-0015 / BR-027)
//   - INSERT-IF-ABSENT via upsert-by-slug with an EMPTY update (never overwrites
//     an admin-modified row) — the same idempotency contract as
//     prisma/seed.ts's seedCanonicalTaxonomy and ADR-0015 §6
//   - archiving a junk category is the PUBLIC/HIDDEN → ARCHIVED transition the
//     category-visibility-policy matrix already permits (canTransitionCategory
//     Visibility): allowed from any non-ARCHIVED state, so we archive only when
//     the current status is not already ARCHIVED, and NEVER hard-delete.
//
// It does NOT touch the Prisma schema, auth, RBAC, booking, pricing, the
// Vehicle/Asset domain, or Dynamic Fields.

import { isValidServiceTypeKey } from "../service-types/registry";
import { MAX_CATEGORY_DEPTH } from "./category-tree";

// The approved BARQ v1 customer-facing roots (ADR-0016). Order is the public
// homepage/discovery order (sortOrder).
export const APPROVED_ROOTS = [
  { slug: "cars", ar: "سيارات للإيجار", en: "Car Rentals", serviceTypeKey: "RENTAL" },
  { slug: "tours-experiences", ar: "جولات وتجارب", en: "Tours & Experiences", serviceTypeKey: "EXPERIENCE" },
  { slug: "marine-trips", ar: "رحلات بحرية", en: "Marine Trips", serviceTypeKey: "EXPERIENCE" },
  { slug: "transfers", ar: "نقل وتوصيل", en: "Transfers", serviceTypeKey: "TRANSPORT" },
] as const;

// The single root that carries children in v1.
export const TOURS_PARENT_SLUG = "tours-experiences";

// Depth-1 children of tours-experiences. They INHERIT the parent's vertical
// (EXPERIENCE) per BR-023 — a child can never belong to a different vertical.
export const APPROVED_TOURS_CHILDREN = [
  { slug: "tourist-guides", ar: "مرشدون سياحيون", en: "Tourist Guides" },
  { slug: "adventures", ar: "مغامرات", en: "Adventures" },
  { slug: "local-experiences", ar: "تجارب محلية", en: "Local Experiences" },
  { slug: "cultural-tours", ar: "جولات ثقافية", en: "Cultural Tours" },
] as const;

// Children always inherit this vertical from TOURS_PARENT_SLUG (a root defined
// above as EXPERIENCE). Kept as a named constant so the invariant is explicit.
const TOURS_CHILD_SERVICE_TYPE_KEY = "EXPERIENCE";

// The exact junk root categories to archive on staging (slugs "1" / "2"),
// created by earlier manual poking. Archived ONLY when provably dependency-free.
export const JUNK_ROOT_SLUGS = ["1", "2"] as const;

// Mirrors the slug pattern in create-category.ts (kept in sync intentionally).
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// Environment guard — staging only.
// ---------------------------------------------------------------------------

export class StagingGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StagingGuardError";
  }
}

// Refuse to run anywhere but staging (unset, local, and production all refuse).
export function assertStagingEnvironment(appEnv: string | undefined): void {
  if (appEnv !== "staging") {
    throw new StagingGuardError(
      `Refusing to run: APP_ENV must be "staging" (got "${appEnv ?? "unset"}"). ` +
        "This bootstrap is staging-only and never runs against production or local."
    );
  }
}

// ---------------------------------------------------------------------------
// Minimal structural Prisma surface this bootstrap needs. The real PrismaClient
// satisfies it; a test supplies a mock. Kept narrow on purpose.
// ---------------------------------------------------------------------------

export type CategoryRow = {
  id: string;
  slug: string;
  visibilityStatus: string;
  parentId: string | null;
};

export interface TaxonomyBootstrapPrisma {
  category: {
    findUnique(args: { where: { slug: string } }): Promise<CategoryRow | null>;
    upsert(args: {
      where: { slug: string };
      update: Record<string, never>;
      create: {
        name: { ar: string; en: string };
        slug: string;
        serviceTypeKey: string;
        parentId: string | null;
        depth: number;
        sortOrder: number;
        visibilityStatus: "PUBLIC";
      };
    }): Promise<CategoryRow>;
    update(args: { where: { id: string }; data: { visibilityStatus: "ARCHIVED" } }): Promise<CategoryRow>;
    count(args: { where: { parentId: string } }): Promise<number>;
  };
  service: { count(args: { where: { categoryId: string } }): Promise<number> };
  providerCategory: { count(args: { where: { categoryId: string } }): Promise<number> };
}

// ---------------------------------------------------------------------------
// Outcome model — same shape for dry-run and apply (dry-run reports the plan).
// ---------------------------------------------------------------------------

// "created" means created when applied=true, and "would create" when applied=false.
export type UpsertAction = "created" | "exists";
export type CategoryOutcome = { slug: string; kind: "root" | "child"; action: UpsertAction; id: string | null };

// "archived" means archived when applied=true, and "would archive" when applied=false.
export type JunkAction = "archived" | "already-archived" | "absent" | "blocked";
export type JunkDeps = { services: number; providerLinks: number; children: number };
export type JunkOutcome = { slug: string; action: JunkAction; id: string | null; deps: JunkDeps | null };

export type BootstrapReport = {
  applied: boolean;
  roots: CategoryOutcome[];
  children: CategoryOutcome[];
  junk: JunkOutcome[];
};

// Defensive spec validation — the approved data is valid, but a future edit
// that breaks a domain rule must fail loudly here, not silently write bad rows.
export function validateTaxonomySpec(): void {
  const seen = new Set<string>();
  const items: Array<{ slug: string; serviceTypeKey: string; depth: number }> = [
    ...APPROVED_ROOTS.map((r) => ({ slug: r.slug, serviceTypeKey: r.serviceTypeKey, depth: 0 })),
    ...APPROVED_TOURS_CHILDREN.map((c) => ({ slug: c.slug, serviceTypeKey: TOURS_CHILD_SERVICE_TYPE_KEY, depth: 1 })),
  ];
  for (const item of items) {
    if (!SLUG_PATTERN.test(item.slug)) throw new Error(`Invalid slug in taxonomy spec: "${item.slug}"`);
    if (seen.has(item.slug)) throw new Error(`Duplicate slug in taxonomy spec: "${item.slug}"`);
    seen.add(item.slug);
    if (!isValidServiceTypeKey(item.serviceTypeKey)) {
      throw new Error(`Invalid serviceTypeKey in taxonomy spec for "${item.slug}": "${item.serviceTypeKey}"`);
    }
    if (item.depth >= MAX_CATEGORY_DEPTH) {
      throw new Error(`Depth ${item.depth} for "${item.slug}" reaches/exceeds MAX_CATEGORY_DEPTH (${MAX_CATEGORY_DEPTH}).`);
    }
  }
  for (const junk of JUNK_ROOT_SLUGS) {
    if (seen.has(junk)) throw new Error(`Junk slug "${junk}" collides with an approved taxonomy slug.`);
  }
}

// ---------------------------------------------------------------------------
// Core bootstrap. Reads in both modes; writes only when options.apply is true.
// ---------------------------------------------------------------------------

export async function runStagingTaxonomyBootstrap(
  prisma: TaxonomyBootstrapPrisma,
  options: { apply: boolean }
): Promise<BootstrapReport> {
  validateTaxonomySpec();
  const { apply } = options;

  // --- Roots (insert-if-absent, PUBLIC on creation) ---
  const roots: CategoryOutcome[] = [];
  const rootIdBySlug = new Map<string, string | null>();
  let rootSortOrder = 0;
  for (const root of APPROVED_ROOTS) {
    const existing = await prisma.category.findUnique({ where: { slug: root.slug } });
    if (existing) {
      roots.push({ slug: root.slug, kind: "root", action: "exists", id: existing.id });
      rootIdBySlug.set(root.slug, existing.id);
    } else if (apply) {
      const created = await prisma.category.upsert({
        where: { slug: root.slug },
        update: {},
        create: {
          name: { ar: root.ar, en: root.en },
          slug: root.slug,
          serviceTypeKey: root.serviceTypeKey,
          parentId: null,
          depth: 0,
          sortOrder: rootSortOrder,
          visibilityStatus: "PUBLIC",
        },
      });
      roots.push({ slug: root.slug, kind: "root", action: "created", id: created.id });
      rootIdBySlug.set(root.slug, created.id);
    } else {
      roots.push({ slug: root.slug, kind: "root", action: "created", id: null });
      rootIdBySlug.set(root.slug, null);
    }
    rootSortOrder++;
  }

  // --- Children of tours-experiences (inherit EXPERIENCE, depth 1, PUBLIC) ---
  const parentId = rootIdBySlug.get(TOURS_PARENT_SLUG) ?? null;
  const children: CategoryOutcome[] = [];
  let childSortOrder = 0;
  for (const child of APPROVED_TOURS_CHILDREN) {
    const existing = await prisma.category.findUnique({ where: { slug: child.slug } });
    if (existing) {
      children.push({ slug: child.slug, kind: "child", action: "exists", id: existing.id });
    } else if (apply) {
      if (!parentId) {
        // In apply mode the parent root was upserted above, so its id must exist.
        throw new Error(`Bootstrap invariant broken: parent "${TOURS_PARENT_SLUG}" id missing while creating child "${child.slug}".`);
      }
      const created = await prisma.category.upsert({
        where: { slug: child.slug },
        update: {},
        create: {
          name: { ar: child.ar, en: child.en },
          slug: child.slug,
          serviceTypeKey: TOURS_CHILD_SERVICE_TYPE_KEY,
          parentId,
          depth: 1,
          sortOrder: childSortOrder,
          visibilityStatus: "PUBLIC",
        },
      });
      children.push({ slug: child.slug, kind: "child", action: "created", id: created.id });
    } else {
      children.push({ slug: child.slug, kind: "child", action: "created", id: null });
    }
    childSortOrder++;
  }

  // --- Junk archive (only when provably dependency-free; never hard-delete) ---
  const junk: JunkOutcome[] = [];
  for (const slug of JUNK_ROOT_SLUGS) {
    const existing = await prisma.category.findUnique({ where: { slug } });
    if (!existing) {
      junk.push({ slug, action: "absent", id: null, deps: null });
      continue;
    }
    const [services, providerLinks, childCount] = await Promise.all([
      prisma.service.count({ where: { categoryId: existing.id } }),
      prisma.providerCategory.count({ where: { categoryId: existing.id } }),
      prisma.category.count({ where: { parentId: existing.id } }),
    ]);
    const deps: JunkDeps = { services, providerLinks, children: childCount };

    if (services > 0 || providerLinks > 0 || childCount > 0) {
      // Real dependency — refuse to archive, report for manual review.
      junk.push({ slug, action: "blocked", id: existing.id, deps });
      continue;
    }
    if (existing.visibilityStatus === "ARCHIVED") {
      junk.push({ slug, action: "already-archived", id: existing.id, deps });
      continue;
    }
    if (apply) {
      await prisma.category.update({ where: { id: existing.id }, data: { visibilityStatus: "ARCHIVED" } });
    }
    junk.push({ slug, action: "archived", id: existing.id, deps });
  }

  return { applied: apply, roots, children, junk };
}
