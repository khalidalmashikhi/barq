import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.7 (Availability Foundation) — regression tests for
// updateAvailability(), the admin-initiated edit path.

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

const { updateAvailability } = await import("./update-availability");

const SLOT_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

afterEach(() => {
  requireAdminMock.mockReset();
  availabilityFindUniqueMock.mockReset();
  availabilityUpdateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("updateAvailability", () => {
  it("returns INVALID_INPUT for a malformed slotId without checking admin status", async () => {
    const result = await updateAvailability("not-a-uuid", buildFormData({ capacity: "5" }));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT for a zero or negative capacity", async () => {
    const result = await updateAvailability(SLOT_ID, buildFormData({ capacity: "0" }));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns NO_ADMIN_PROFILE when the caller has no Admin profile", async () => {
    const { ForbiddenError } = await import("@/lib/auth");
    requireAdminMock.mockRejectedValue(new ForbiddenError("Admin role required"));

    const result = await updateAvailability(SLOT_ID, buildFormData({ capacity: "5" }));

    expect(result).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
    expect(availabilityUpdateMock).not.toHaveBeenCalled();
  });

  it("returns SLOT_NOT_FOUND when the slot doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    availabilityFindUniqueMock.mockResolvedValue(null);

    const result = await updateAvailability(SLOT_ID, buildFormData({ capacity: "5" }));

    expect(result).toEqual({ ok: false, error: "SLOT_NOT_FOUND" });
    expect(availabilityUpdateMock).not.toHaveBeenCalled();
  });

  it("returns CAPACITY_BELOW_BOOKED when the new capacity is below bookedCount", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    availabilityFindUniqueMock.mockResolvedValue({
      id: SLOT_ID,
      capacity: 5,
      bookedCount: 3,
      startTime: new Date(Date.now() + 60 * 60 * 1000),
      endTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });

    const result = await updateAvailability(SLOT_ID, buildFormData({ capacity: "2" }));

    expect(result).toEqual({ ok: false, error: "CAPACITY_BELOW_BOOKED" });
    expect(availabilityUpdateMock).not.toHaveBeenCalled();
  });

  it("returns SLOT_HAS_BOOKINGS when attempting to change time on a booked slot", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    availabilityFindUniqueMock.mockResolvedValue({
      id: SLOT_ID,
      capacity: 5,
      bookedCount: 2,
      startTime: new Date(Date.now() + 60 * 60 * 1000),
      endTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });

    const newStart = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const newEnd = new Date(newStart.getTime() + 60 * 60 * 1000);

    const result = await updateAvailability(
      SLOT_ID,
      buildFormData({ capacity: "5", startTime: newStart.toISOString(), endTime: newEnd.toISOString() })
    );

    expect(result).toEqual({ ok: false, error: "SLOT_HAS_BOOKINGS" });
    expect(availabilityUpdateMock).not.toHaveBeenCalled();
  });

  it("updates capacity and records an audit event", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    availabilityFindUniqueMock.mockResolvedValue({
      id: SLOT_ID,
      capacity: 5,
      bookedCount: 0,
      startTime: new Date(Date.now() + 60 * 60 * 1000),
      endTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });
    availabilityUpdateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await updateAvailability(SLOT_ID, buildFormData({ capacity: "8" }));

    expect(result).toEqual({ ok: true });
    expect(availabilityUpdateMock).toHaveBeenCalledWith({ where: { id: SLOT_ID }, data: { capacity: 8 } });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "ADMIN",
        actorId: "admin-1",
        action: "availability.slot_updated",
        entityType: "Availability",
        entityId: SLOT_ID,
      }),
    });
  });
});
