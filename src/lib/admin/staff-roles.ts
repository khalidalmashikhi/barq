import type { StaffRole } from "@prisma/client";

// Staff role parsing/ordering — User & Access Management (Batch 4). Single
// source of truth for the canonical StaffRole order and for turning raw form
// input into a validated, deduplicated, deterministically-ordered role set.
// Uses ONLY the existing StaffRole enum — no new roles or permission concepts.

export const STAFF_ROLES: readonly StaffRole[] = ["OPERATIONS", "SUPPORT", "FINANCE"];

export type ParseStaffRolesResult = { ok: true; roles: StaffRole[] } | { ok: false; reason: "empty" | "invalid" };

// Validates against the real enum, removes duplicates, and returns the roles
// in canonical enum order (deterministic storage). Rejects an empty set and
// any value that isn't a real StaffRole — distinctly, so callers can surface
// "empty" vs "invalid" differently.
export function parseStaffRoles(input: string[]): ParseStaffRolesResult {
  const unique = Array.from(new Set(input.map((r) => r.trim()).filter(Boolean)));
  if (unique.length === 0) return { ok: false, reason: "empty" };
  const invalid = unique.filter((r) => !(STAFF_ROLES as readonly string[]).includes(r));
  if (invalid.length > 0) return { ok: false, reason: "invalid" };
  const roles = STAFF_ROLES.filter((r) => unique.includes(r));
  return { ok: true, roles };
}

// Set equality (order-independent) — used to detect a no-op role update.
export function sameRoleSet(a: readonly StaffRole[], b: readonly StaffRole[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((r) => set.has(r));
}
