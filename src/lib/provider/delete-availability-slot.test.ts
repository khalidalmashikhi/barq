import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 5.2 (Production Hardening) — regression tests for
// deleteAvailabilitySlot(), extended this phase to wrap the delete and
// its new audit-log write in one transaction.

vi.mock("server-only", () => ({}));

const requireProviderMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: (...args: unknown[]) => requireProviderMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const findFirstMock = vi.fn();
const deleteMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    availability: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        availability: { delete: (...args: unknown[]) => deleteMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { deleteAvailabilitySlot } = await import("./delete-availability-slot");

const SLOT_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireProviderMock.mockReset();
  findFirstMock.mockReset();
  deleteMock.mockReset();
  auditCreateMock.mockReset();
});

describe("deleteAvailabilitySlot", () => {
  it("deletes the slot and records an audit event, in the same transaction", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findFirstMock.mockResolvedValue({
      id: SLOT_ID,
      serviceId: "service-1",
      bookedCount: 0,
      capacity: 2,
      startTime: new Date("2026-08-01T10:00:00Z"),
      endTime: new Date("2026-08-01T11:00:00Z"),
    });
    deleteMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await deleteAvailabilitySlot(SLOT_ID);

    expect(result).toEqual({ ok: true });
    expect(deleteMock).toHaveBeenCalledWith({ where: { id: SLOT_ID } });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "availability.slot_deleted",
        entityType: "Availability",
        entityId: SLOT_ID,
        previousValue: expect.objectContaining({ serviceId: "service-1", capacity: 2 }),
      }),
    });
  });

  it("returns SLOT_HAS_BOOKINGS without deleting anything when bookedCount > 0", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findFirstMock.mockResolvedValue({
      id: SLOT_ID,
      serviceId: "service-1",
      bookedCount: 1,
      capacity: 2,
      startTime: new Date("2026-08-01T10:00:00Z"),
      endTime: new Date("2026-08-01T11:00:00Z"),
    });

    const result = await deleteAvailabilitySlot(SLOT_ID);

    expect(result).toEqual({ ok: false, error: "SLOT_HAS_BOOKINGS" });
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
