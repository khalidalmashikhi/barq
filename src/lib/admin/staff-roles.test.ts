import { describe, it, expect } from "vitest";
import { parseStaffRoles, sameRoleSet, STAFF_ROLES } from "./staff-roles";

// User & Access Management (Batch 4) — role parsing/ordering helper.

describe("parseStaffRoles", () => {
  it("rejects an empty selection", () => {
    expect(parseStaffRoles([])).toEqual({ ok: false, reason: "empty" });
    expect(parseStaffRoles(["", "  "])).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects a value that isn't a real StaffRole", () => {
    expect(parseStaffRoles(["MANAGER"])).toEqual({ ok: false, reason: "invalid" });
    expect(parseStaffRoles(["SUPPORT", "BOGUS"])).toEqual({ ok: false, reason: "invalid" });
  });

  it("accepts a single valid role", () => {
    expect(parseStaffRoles(["SUPPORT"])).toEqual({ ok: true, roles: ["SUPPORT"] });
  });

  it("deduplicates and returns canonical enum order regardless of input order", () => {
    expect(parseStaffRoles(["FINANCE", "OPERATIONS", "SUPPORT"])).toEqual({ ok: true, roles: ["OPERATIONS", "SUPPORT", "FINANCE"] });
    expect(parseStaffRoles(["SUPPORT", "SUPPORT"])).toEqual({ ok: true, roles: ["SUPPORT"] });
  });

  it("STAFF_ROLES is exactly the enum, in canonical order", () => {
    expect(STAFF_ROLES).toEqual(["OPERATIONS", "SUPPORT", "FINANCE"]);
  });
});

describe("sameRoleSet", () => {
  it("is order-independent set equality", () => {
    expect(sameRoleSet(["OPERATIONS", "SUPPORT"], ["SUPPORT", "OPERATIONS"])).toBe(true);
    expect(sameRoleSet(["SUPPORT"], ["SUPPORT", "FINANCE"])).toBe(false);
    expect(sameRoleSet([], [])).toBe(true);
  });
});
