import { describe, it, expect, vi, beforeEach } from "vitest";

// STAFF RBAC (Gate Z-3 §21) — THE authoritative permission matrix. Every numbered
// requirement below is verified against the REAL requirePermission/requireOwner guards
// (prisma admin/staff findUnique are the only mocks), for every role scenario × every
// permission key. This is the single executable source of truth for "who can do what";
// per-domain enforcement (that each route/action actually calls the right key) is proven
// by the individual domain test files, and nav/attribution/legacy-staff by their own suites.
//
// Scenarios covered: OWNER, non-owner ADMIN (compat), and the six presets
// (BOOKING_OPS, PROVIDER_VERIFICATION, FINANCE, SUPPORT, CONTENT_MANAGER,
// REVIEW_MODERATOR), plus CUSTOM, ZERO, DEACTIVATED, and privilege-escalation.

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => {
  class ForbiddenError extends Error {
    code?: string;
    constructor(m?: string, c?: string) { super(m); this.code = c; }
  }
  return { requireAuth: vi.fn(), adminFind: vi.fn(), staffFind: vi.fn(), ForbiddenError };
});

vi.mock("./rbac", () => ({ requireAuth: (...a: unknown[]) => h.requireAuth(...a) }));
vi.mock("./errors", () => ({ ForbiddenError: h.ForbiddenError }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/db", () => ({
  prisma: {
    admin: { findUnique: (...a: unknown[]) => h.adminFind(...a) },
    staff: { findUnique: (...a: unknown[]) => h.staffFind(...a) },
  },
}));

const { requirePermission, requireOwner } = await import("./require-permission");
const { PERMISSION_KEYS, STAFF_PRESETS, STAFF_PRESET_NAMES, presetPermissions } = await import("./permissions");
type PermissionKey = (typeof PERMISSION_KEYS)[number];

const USER = { id: "u1" } as never;

beforeEach(() => {
  h.requireAuth.mockReset();
  h.adminFind.mockReset();
  h.staffFind.mockReset();
  h.requireAuth.mockResolvedValue({ barqUser: USER });
  h.adminFind.mockResolvedValue(null);
  h.staffFind.mockResolvedValue(null);
});

function asOwner() {
  h.adminFind.mockResolvedValue({ id: "admin-owner", status: "ACTIVE", level: "OWNER" });
}
function asAdmin() {
  h.adminFind.mockResolvedValue({ id: "admin-1", status: "ACTIVE", level: "ADMIN" });
}
function asStaff(permissions: readonly PermissionKey[], status: "ACTIVE" | "DEACTIVATED" = "ACTIVE") {
  h.adminFind.mockResolvedValue(null);
  h.staffFind.mockResolvedValue({ id: "staff-1", status, permissions: [...permissions] });
}

async function allowed(key: PermissionKey): Promise<boolean> {
  try {
    await requirePermission(key);
    return true;
  } catch {
    return false;
  }
}

// The full 17-key expectation for an actor: the set of keys that MUST be allowed. Every key
// NOT in the set MUST be denied. This is the row-by-row matrix assertion.
async function assertExactGrid(expectedAllowed: ReadonlySet<PermissionKey>) {
  for (const key of PERMISSION_KEYS) {
    const got = await allowed(key);
    expect(got, `${key} should be ${expectedAllowed.has(key) ? "ALLOWED" : "DENIED"}`).toBe(expectedAllowed.has(key));
  }
}

describe("Z-3 matrix — OWNER", () => {
  it("#1 OWNER is allowed EVERY permission key", async () => {
    asOwner();
    await assertExactGrid(new Set(PERMISSION_KEYS));
  });
  it("#2 OWNER passes requireOwner", async () => {
    asOwner();
    await expect(requireOwner()).resolves.toMatchObject({ admin: { id: "admin-owner" } });
  });
});

describe("Z-3 matrix — non-owner ADMIN (compatibility)", () => {
  it("#3 non-owner ADMIN is allowed EVERY domain permission key", async () => {
    asAdmin();
    await assertExactGrid(new Set(PERMISSION_KEYS));
  });
  it("#4 non-owner ADMIN is DENIED requireOwner (never privilege administration)", async () => {
    asAdmin();
    await expect(requireOwner()).rejects.toMatchObject({ code: "INTERNAL_FORBIDDEN" });
  });
});

describe("Z-3 matrix — presets (each grants EXACTLY its keys, nothing more)", () => {
  it.each(STAFF_PRESET_NAMES)("#5 preset %s grants exactly its keys and denies all others", async (preset) => {
    asStaff(presetPermissions(preset));
    await assertExactGrid(new Set(presetPermissions(preset)));
  });

  it("#6 BOOKING_OPS: bookings.read+manage+providers.read, and NEVER bookings.cancel/finance/users/content/settings", async () => {
    asStaff(STAFF_PRESETS.BOOKING_OPS);
    expect(await allowed("bookings.read")).toBe(true);
    expect(await allowed("bookings.manage")).toBe(true);
    expect(await allowed("providers.read")).toBe(true);
    for (const denied of ["bookings.cancel", "finance.read", "finance.manage", "users.read", "users.manage", "content.manage", "settings.manage", "providers.review", "providerDocuments.read", "reviews.moderate", "audit.read"] as PermissionKey[]) {
      expect(await allowed(denied), denied).toBe(false);
    }
  });

  it("#7 PROVIDER_VERIFICATION includes providerDocuments.read but NOT finance/bookings.cancel/staff-scope", async () => {
    asStaff(STAFF_PRESETS.PROVIDER_VERIFICATION);
    expect(await allowed("providers.read")).toBe(true);
    expect(await allowed("providers.review")).toBe(true);
    expect(await allowed("providerDocuments.read")).toBe(true);
    for (const denied of ["providers.manage", "finance.read", "finance.manage", "bookings.cancel", "users.manage", "content.manage", "settings.manage", "reviews.moderate"] as PermissionKey[]) {
      expect(await allowed(denied), denied).toBe(false);
    }
  });

  it("#8 FINANCE is isolated: finance.read+manage+bookings.read only — never providers.review/providerDocuments.read/reviews/users/settings", async () => {
    asStaff(STAFF_PRESETS.FINANCE);
    expect(await allowed("finance.read")).toBe(true);
    expect(await allowed("finance.manage")).toBe(true);
    expect(await allowed("bookings.read")).toBe(true);
    for (const denied of ["providers.review", "providerDocuments.read", "reviews.moderate", "reviews.read", "users.read", "users.manage", "settings.manage", "content.manage", "bookings.cancel", "bookings.manage", "audit.read"] as PermissionKey[]) {
      expect(await allowed(denied), denied).toBe(false);
    }
  });

  it("#9 SUPPORT is read-only: bookings.read+users.read+reviews.read — no manage/cancel/moderate/review anywhere", async () => {
    asStaff(STAFF_PRESETS.SUPPORT);
    expect(await allowed("bookings.read")).toBe(true);
    expect(await allowed("users.read")).toBe(true);
    expect(await allowed("reviews.read")).toBe(true);
    for (const denied of ["bookings.manage", "bookings.cancel", "users.manage", "reviews.moderate", "providers.review", "providers.manage", "finance.manage", "content.manage", "settings.manage", "providerDocuments.read"] as PermissionKey[]) {
      expect(await allowed(denied), denied).toBe(false);
    }
  });

  it("#10 CONTENT_MANAGER: content.read+manage only — never bookings/finance/users/providers/settings", async () => {
    asStaff(STAFF_PRESETS.CONTENT_MANAGER);
    expect(await allowed("content.read")).toBe(true);
    expect(await allowed("content.manage")).toBe(true);
    for (const denied of ["bookings.read", "bookings.manage", "finance.read", "users.read", "providers.read", "providers.review", "settings.manage", "reviews.moderate", "audit.read"] as PermissionKey[]) {
      expect(await allowed(denied), denied).toBe(false);
    }
  });

  it("#11 REVIEW_MODERATOR: reviews.read+moderate only — nothing else", async () => {
    asStaff(STAFF_PRESETS.REVIEW_MODERATOR);
    expect(await allowed("reviews.read")).toBe(true);
    expect(await allowed("reviews.moderate")).toBe(true);
    for (const denied of ["bookings.read", "providers.read", "providers.review", "finance.read", "users.read", "content.read", "settings.manage", "providerDocuments.read", "audit.read"] as PermissionKey[]) {
      expect(await allowed(denied), denied).toBe(false);
    }
  });
});

describe("Z-3 matrix — CUSTOM / ZERO / DEACTIVATED", () => {
  it("#12 a CUSTOM explicit set grants exactly those keys", async () => {
    const custom = new Set<PermissionKey>(["bookings.read", "bookings.cancel", "audit.read"]);
    asStaff([...custom]);
    await assertExactGrid(custom);
  });

  it("#13 a ZERO-permission staff is denied EVERY key", async () => {
    asStaff([]);
    await assertExactGrid(new Set());
  });

  it("#14 a DEACTIVATED staff is denied EVERY key even with a full grant", async () => {
    asStaff(PERMISSION_KEYS, "DEACTIVATED");
    await assertExactGrid(new Set());
  });

  it("#15 junk/unknown permission strings are dropped — only valid granted keys are honored", async () => {
    asStaff(["bookings.read", "not.a.key", "", "DROP TABLE"] as unknown as PermissionKey[]);
    await assertExactGrid(new Set<PermissionKey>(["bookings.read"]));
  });
});

describe("Z-3 matrix — privilege escalation is impossible via any preset/staff", () => {
  it("#16 NO preset grants the high-impact bookings.cancel", () => {
    for (const preset of STAFF_PRESET_NAMES) {
      expect(presetPermissions(preset)).not.toContain("bookings.cancel");
    }
  });

  it("#17 NO staff (even with ALL 17 keys) passes requireOwner", async () => {
    asStaff(PERMISSION_KEYS);
    await expect(requireOwner()).rejects.toMatchObject({ code: "INTERNAL_FORBIDDEN" });
  });

  it("#18 a customer/provider (no internal row) is denied every key and requireOwner", async () => {
    // adminFind + staffFind both null (default) → not internal
    await assertExactGrid(new Set());
    await expect(requireOwner()).rejects.toMatchObject({ code: "INTERNAL_FORBIDDEN" });
  });
});

describe("Z-3 matrix — actor attribution returned by requirePermission", () => {
  it("#19 STAFF actor attributes as STAFF/Staff.id with admin=null (FK null)", async () => {
    asStaff(["reviews.moderate"]);
    const { actor } = await requirePermission("reviews.moderate");
    expect(actor).toMatchObject({ actorType: "STAFF", actorId: "staff-1", isOwner: false });
    expect(actor.admin).toBeNull();
  });

  it("#20 ADMIN actor attributes as ADMIN/Admin.id with the admin row (FK settable)", async () => {
    asAdmin();
    const { actor } = await requirePermission("providers.review");
    expect(actor).toMatchObject({ actorType: "ADMIN", actorId: "admin-1", isOwner: false });
    expect(actor.admin?.id).toBe("admin-1");
  });

  it("#21 an ACTIVE Admin dominates a Staff row on the same user (admin precedence)", async () => {
    h.adminFind.mockResolvedValue({ id: "admin-1", status: "ACTIVE", level: "ADMIN" });
    h.staffFind.mockResolvedValue({ id: "staff-1", status: "ACTIVE", permissions: [] });
    const { actor } = await requirePermission("finance.manage");
    expect(actor.actorType).toBe("ADMIN");
  });
});
