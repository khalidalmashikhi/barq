import { describe, it, expect } from "vitest";
import { readdirSync, existsSync } from "node:fs";
import path from "node:path";

// VEHICLE-LC2B HOTFIX — structural route-tree guard.
//
// Next.js throws at RUNTIME (not build) if a single parent path segment has two
// dynamic children with DIFFERENT slug names, e.g. `[id]` beside `[vehicleId]`:
//   "You cannot use different slug names for the same dynamic path ('vehicleId' !== 'id')."
// That took down ALL dynamic routing on staging once LC2B added a `[vehicleId]`
// sibling to the pre-existing `[id]`. `next build` + tsc + unit tests all PASSED and
// even listed both routes — the conflict is invisible to them. This filesystem guard
// reproduces the exact check Next does, so the mistake can never silently return.

const APP_DIR = path.join(process.cwd(), "src", "app");
const VEHICLES_DIR = path.join(APP_DIR, "api", "v1", "me", "provider", "vehicles");

// A Next.js dynamic segment dir: [x], [...x], or [[...x]]. The "slug name" is the
// identifier inside, ignoring the optional/catch-all markers — that is what Next
// requires to match across siblings.
function dynamicSlugName(dirName: string): string | null {
  return dirName.match(/^\[+(?:\.\.\.)?([^\]]+)\]+$/)?.[1] ?? null;
}

function listDirs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

// Every directory with a "parent → [conflicting dynamic child slug names]" violation.
function findSiblingSlugConflicts(root: string): { parent: string; slugs: string[] }[] {
  const conflicts: { parent: string; slugs: string[] }[] = [];
  const walk = (dir: string) => {
    const children = listDirs(dir);
    const slugs = new Set<string>();
    for (const name of children) {
      const slug = dynamicSlugName(name);
      if (slug) slugs.add(slug);
      walk(path.join(dir, name));
    }
    if (slugs.size > 1) conflicts.push({ parent: path.relative(APP_DIR, dir), slugs: [...slugs] });
  };
  walk(root);
  return conflicts;
}

describe("app router dynamic-segment integrity", () => {
  it("no directory anywhere in src/app has two dynamic children with different slug names", () => {
    const conflicts = findSiblingSlugConflicts(APP_DIR);
    expect(conflicts, `sibling dynamic-slug conflicts (Next.js runtime failure): ${JSON.stringify(conflicts)}`).toEqual([]);
  });

  it("the api/v1 vehicles namespace uses exactly one dynamic segment: [id] (never [vehicleId])", () => {
    const dynamicChildren = listDirs(VEHICLES_DIR).filter((n) => dynamicSlugName(n) !== null);
    expect(dynamicChildren).toEqual(["[id]"]);
    expect(existsSync(path.join(VEHICLES_DIR, "[vehicleId]"))).toBe(false);
  });

  it("VEHICLE-1B [id]/route.ts and the LC2B verification/documents routes coexist under [id]", () => {
    const idDir = path.join(VEHICLES_DIR, "[id]");
    // VEHICLE-1B detail (GET/PATCH) stays.
    expect(existsSync(path.join(idDir, "route.ts"))).toBe(true);
    // LC2B routes now live beneath the same [id] segment.
    expect(existsSync(path.join(idDir, "verification", "route.ts"))).toBe(true);
    expect(existsSync(path.join(idDir, "verification", "submit", "route.ts"))).toBe(true);
    expect(existsSync(path.join(idDir, "documents", "route.ts"))).toBe(true);
    expect(existsSync(path.join(idDir, "documents", "[docId]", "route.ts"))).toBe(true);
    expect(existsSync(path.join(idDir, "documents", "[docId]", "replace", "route.ts"))).toBe(true);
    expect(existsSync(path.join(idDir, "documents", "[docId]", "view", "route.ts"))).toBe(true);
  });
});
