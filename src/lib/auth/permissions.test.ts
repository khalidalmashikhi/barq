import { describe, it, expect } from "vitest";
import {
  PERMISSION_KEYS,
  isPermissionKey,
  sanitizePermissionKeys,
  STAFF_PRESETS,
  isStaffPresetName,
  presetPermissions,
  modulesForPermissions,
} from "./permissions";

describe("permission taxonomy", () => {
  it("isPermissionKey accepts real keys and rejects junk", () => {
    expect(isPermissionKey("providers.review")).toBe(true);
    expect(isPermissionKey("bookings.cancel")).toBe(true);
    expect(isPermissionKey("providers.approve")).toBe(false); // merged into providers.review
    expect(isPermissionKey("owner")).toBe(false);
    expect(isPermissionKey("")).toBe(false);
    expect(isPermissionKey(null)).toBe(false);
  });

  it("sanitizePermissionKeys drops invalid + dedupes and returns canonical order", () => {
    const out = sanitizePermissionKeys(["reviews.moderate", "bogus", "reviews.moderate", "bookings.read"]);
    expect(out).toEqual(["bookings.read", "reviews.moderate"]); // taxonomy order, deduped, no junk
  });
});

describe("presets", () => {
  it("BOOKING_OPS deliberately EXCLUDES bookings.cancel (high-impact, OWNER-granted only)", () => {
    expect(STAFF_PRESETS.BOOKING_OPS).not.toContain("bookings.cancel");
    expect(presetPermissions("BOOKING_OPS")).toEqual(["bookings.read", "bookings.manage", "providers.read"]);
  });

  it("PROVIDER_VERIFICATION includes providerDocuments.read but no finance", () => {
    const p = presetPermissions("PROVIDER_VERIFICATION");
    expect(p).toContain("providerDocuments.read");
    expect(p).toContain("providers.review");
    expect(p.some((k) => k.startsWith("finance."))).toBe(false);
  });

  it("FINANCE has no provider review / no provider documents", () => {
    const p = presetPermissions("FINANCE");
    expect(p).not.toContain("providers.review");
    expect(p).not.toContain("providerDocuments.read");
  });

  it("SUPPORT is data-minimized reads only (no docs, no finance)", () => {
    expect(presetPermissions("SUPPORT")).toEqual(["bookings.read", "users.read", "reviews.read"]);
  });

  it("every preset is composed only of valid keys", () => {
    for (const name of Object.keys(STAFF_PRESETS)) {
      expect(isStaffPresetName(name)).toBe(true);
      for (const k of STAFF_PRESETS[name as keyof typeof STAFF_PRESETS]) expect(isPermissionKey(k)).toBe(true);
    }
  });
});

describe("modules", () => {
  it("maps permissions to distinct modules", () => {
    expect(modulesForPermissions(["providers.review", "providerDocuments.read"]).sort()).toEqual(
      ["providerDocuments", "providers"]
    );
    expect(modulesForPermissions([])).toEqual([]);
  });
  it("every permission key has a module", () => {
    for (const k of PERMISSION_KEYS) expect(modulesForPermissions([k])).toHaveLength(1);
  });
});
