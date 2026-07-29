import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 5.2 (Production Hardening) — regression test for
// createAvailabilitySlotsBulk(), extended this phase to append one
// summary audit event to the existing array-form $transaction (one
// event for the whole batch, not one per created slot).

vi.mock("server-only", () => ({}));

const requireProviderMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: (...args: unknown[]) => requireProviderMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const findFirstMock = vi.fn();
const availabilityCreateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    service: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
    availability: {
      create: (...args: unknown[]) => availabilityCreateMock(...args),
    },
    auditLog: {
      create: (...args: unknown[]) => auditCreateMock(...args),
    },
    $transaction: async (operations: unknown[]) => Promise.all(operations),
  },
}));

const { createAvailabilitySlotsBulk } = await import("./create-availability-slots-bulk");

const SERVICE_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

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
  availabilityCreateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("createAvailabilitySlotsBulk", () => {
  it("creates one slot per day and exactly one summary audit event for the whole batch", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findFirstMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1" });
    availabilityCreateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const year = new Date().getFullYear() + 1;

    const result = await createAvailabilitySlotsBulk(
      buildFormData({
        serviceId: SERVICE_ID,
        startDate: `${year}-01-01`,
        endDate: `${year}-01-03`,
        startTimeOfDay: "09:00",
        endTimeOfDay: "12:00",
        capacity: "2",
      })
    );

    expect(result).toEqual({ ok: true, createdCount: 3 });
    expect(availabilityCreateMock).toHaveBeenCalledTimes(3);
    expect(auditCreateMock).toHaveBeenCalledTimes(1);
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "PROVIDER",
        actorId: "provider-1",
        action: "availability.bulk_created",
        entityType: "Availability",
        entityId: SERVICE_ID,
        newValue: expect.objectContaining({ count: 3, capacity: 2 }),
      }),
    });
  });

  it("returns SERVICE_NOT_FOUND without creating anything when the service doesn't belong to this provider", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findFirstMock.mockResolvedValue(null);

    const year = new Date().getFullYear() + 1;

    const result = await createAvailabilitySlotsBulk(
      buildFormData({
        serviceId: SERVICE_ID,
        startDate: `${year}-01-01`,
        endDate: `${year}-01-03`,
        startTimeOfDay: "09:00",
        endTimeOfDay: "12:00",
        capacity: "2",
      })
    );

    expect(result).toEqual({ ok: false, error: "SERVICE_NOT_FOUND" });
    expect(availabilityCreateMock).not.toHaveBeenCalled();
    expect(auditCreateMock).not.toHaveBeenCalled();
  });
});
