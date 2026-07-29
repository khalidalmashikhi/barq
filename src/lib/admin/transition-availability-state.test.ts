import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.7 (Availability Foundation) — regression tests for
// activateAvailability/deactivateAvailability, the OPEN <-> BLOCKED
// transition this phase introduces.

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const availabilityFindUniqueMock = vi.fn();
const availabilityUpdateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    availability: {
      findUnique: (...args: unknown[]) => availabilityFindUniqueMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        availability: { update: (...args: unknown[]) => availabilityUpdateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { activateAvailability, deactivateAvailability } = await import("./transition-availability-state");

const SLOT_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  availabilityFindUniqueMock.mockReset();
  availabilityUpdateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("deactivateAvailability", () => {
  it("returns NO_ADMIN_PROFILE when the caller has no Admin profile", async () => {
    const { ForbiddenError } = await import("@/lib/auth");
    requireAdminMock.mockRejectedValue(new ForbiddenError("Admin role required"));

    const result = await deactivateAvailability(SLOT_ID);

    expect(result).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
    expect(availabilityUpdateMock).not.toHaveBeenCalled();
  });

  it("returns SLOT_NOT_FOUND when the slot doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    availabilityFindUniqueMock.mockResolvedValue(null);

    const result = await deactivateAvailability(SLOT_ID);

    expect(result).toEqual({ ok: false, error: "SLOT_NOT_FOUND" });
    expect(availabilityUpdateMock).not.toHaveBeenCalled();
  });

  it("deactivates an OPEN slot even with active bookings, and records an audit event", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    availabilityFindUniqueMock.mockResolvedValue({ id: SLOT_ID, state: "OPEN", bookedCount: 3 });
    availabilityUpdateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await deactivateAvailability(SLOT_ID);

    expect(result).toEqual({ ok: true });
    expect(availabilityUpdateMock).toHaveBeenCalledWith({ where: { id: SLOT_ID }, data: { state: "BLOCKED" } });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "ADMIN",
        actorId: "admin-1",
        action: "availability.slot_deactivated",
        entityType: "Availability",
        entityId: SLOT_ID,
        previousValue: { state: "OPEN" },
        newValue: { state: "BLOCKED" },
      }),
    });
  });

  it("refuses to deactivate a slot that isn't currently OPEN", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    availabilityFindUniqueMock.mockResolvedValue({ id: SLOT_ID, state: "BLOCKED", bookedCount: 0 });

    const result = await deactivateAvailability(SLOT_ID);

    expect(result).toEqual({ ok: false, error: "INVALID_STATE_TRANSITION" });
    expect(availabilityUpdateMock).not.toHaveBeenCalled();
  });
});

describe("activateAvailability", () => {
  it("activates a BLOCKED slot and records an audit event", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    availabilityFindUniqueMock.mockResolvedValue({ id: SLOT_ID, state: "BLOCKED", bookedCount: 0 });
    availabilityUpdateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await activateAvailability(SLOT_ID);

    expect(result).toEqual({ ok: true });
    expect(availabilityUpdateMock).toHaveBeenCalledWith({ where: { id: SLOT_ID }, data: { state: "OPEN" } });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "availability.slot_activated", newValue: { state: "OPEN" } }),
    });
  });

  it("refuses to activate a slot that isn't currently BLOCKED", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    availabilityFindUniqueMock.mockResolvedValue({ id: SLOT_ID, state: "OPEN", bookedCount: 0 });

    const result = await activateAvailability(SLOT_ID);

    expect(result).toEqual({ ok: false, error: "INVALID_STATE_TRANSITION" });
    expect(availabilityUpdateMock).not.toHaveBeenCalled();
  });
});
