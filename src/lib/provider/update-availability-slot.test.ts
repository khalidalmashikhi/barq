import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 5.2 (Production Hardening) — regression tests for
// updateAvailabilitySlot(), extended this phase to wrap the update and
// its new audit-log write in one transaction.

vi.mock("server-only", () => ({}));

const requireProviderMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: (...args: unknown[]) => requireProviderMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const findFirstMock = vi.fn();
const updateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    availability: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        availability: { update: (...args: unknown[]) => updateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { updateAvailabilitySlot } = await import("./update-availability-slot");

const SLOT_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

afterEach(() => {
  requireProviderMock.mockReset();
  findFirstMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("updateAvailabilitySlot", () => {
  it("updates capacity and records an audit event, in the same transaction", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findFirstMock.mockResolvedValue({
      id: SLOT_ID,
      bookedCount: 0,
      capacity: 2,
      startTime: new Date("2026-08-01T10:00:00Z"),
      endTime: new Date("2026-08-01T11:00:00Z"),
    });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await updateAvailabilitySlot(SLOT_ID, buildFormData({ capacity: "5" }));

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: SLOT_ID }, data: { capacity: 5 } });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "availability.slot_updated",
        entityType: "Availability",
        entityId: SLOT_ID,
        previousValue: expect.objectContaining({ capacity: 2 }),
        newValue: { capacity: 5 },
      }),
    });
  });

  it("returns CAPACITY_BELOW_BOOKED without mutating anything when capacity would drop below bookedCount", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findFirstMock.mockResolvedValue({
      id: SLOT_ID,
      bookedCount: 3,
      capacity: 5,
      startTime: new Date("2026-08-01T10:00:00Z"),
      endTime: new Date("2026-08-01T11:00:00Z"),
    });

    const result = await updateAvailabilitySlot(SLOT_ID, buildFormData({ capacity: "2" }));

    expect(result).toEqual({ ok: false, error: "CAPACITY_BELOW_BOOKED" });
    expect(updateMock).not.toHaveBeenCalled();
  });
});
