import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 5.2 (Production Hardening) — regression tests for
// createAvailabilitySlot(), extended this phase to wrap the create and
// its new audit-log write in one transaction.

vi.mock("server-only", () => ({}));

const requireProviderMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: (...args: unknown[]) => requireProviderMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const findFirstMock = vi.fn();
const createMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    service: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        availability: { create: (...args: unknown[]) => createMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { createAvailabilitySlot } = await import("./create-availability-slot");

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
  createMock.mockReset();
  auditCreateMock.mockReset();
});

describe("createAvailabilitySlot", () => {
  it("creates the slot and records an audit event, in the same transaction", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findFirstMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1" });
    createMock.mockResolvedValue({ id: "slot-1" });
    auditCreateMock.mockResolvedValue({});

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const futureEnd = new Date(future.getTime() + 60 * 60 * 1000);

    const result = await createAvailabilitySlot(
      buildFormData({
        serviceId: SERVICE_ID,
        startTime: future.toISOString(),
        endTime: futureEnd.toISOString(),
        capacity: "2",
      })
    );

    expect(result).toEqual({ ok: true });
    expect(createMock).toHaveBeenCalledWith({
      data: { serviceId: SERVICE_ID, startTime: future, endTime: futureEnd, capacity: 2 },
    });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "PROVIDER",
        actorId: "provider-1",
        action: "availability.slot_created",
        entityType: "Availability",
        entityId: "slot-1",
      }),
    });
  });

  it("interprets a naive datetime-local value as Asia/Muscat and persists the correct UTC instant (AVAIL-TZ-FIX)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findFirstMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1" });
    createMock.mockResolvedValue({ id: "slot-1" });
    auditCreateMock.mockResolvedValue({});

    // A far-future naive Oman wall-clock (what <input type="datetime-local">
    // sends). 09:00 Muscat = 05:00Z; 12:00 Muscat = 08:00Z. Fixed UTC expectation
    // ⇒ passes only if the server converts via Asia/Muscat, not its own timezone.
    const result = await createAvailabilitySlot(
      buildFormData({ serviceId: SERVICE_ID, startTime: "2099-06-01T09:00", endTime: "2099-06-01T12:00", capacity: "2" })
    );

    expect(result).toEqual({ ok: true });
    expect(createMock).toHaveBeenCalledWith({
      data: {
        serviceId: SERVICE_ID,
        startTime: new Date("2099-06-01T05:00:00.000Z"),
        endTime: new Date("2099-06-01T08:00:00.000Z"),
        capacity: 2,
      },
    });
  });

  it("rejects a naive Oman wall-clock that is in the past (Oman-boundary validation)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findFirstMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1" });

    const result = await createAvailabilitySlot(
      buildFormData({ serviceId: SERVICE_ID, startTime: "2000-01-01T09:00", endTime: "2000-01-01T12:00", capacity: "2" })
    );

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns SERVICE_NOT_FOUND without creating anything when the service doesn't belong to this provider", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findFirstMock.mockResolvedValue(null);

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const futureEnd = new Date(future.getTime() + 60 * 60 * 1000);

    const result = await createAvailabilitySlot(
      buildFormData({
        serviceId: SERVICE_ID,
        startTime: future.toISOString(),
        endTime: futureEnd.toISOString(),
        capacity: "2",
      })
    );

    expect(result).toEqual({ ok: false, error: "SERVICE_NOT_FOUND" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT when startTime is in the past", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000);
    const pastEnd = new Date(Date.now() - 30 * 60 * 1000);

    const result = await createAvailabilitySlot(
      buildFormData({ serviceId: SERVICE_ID, startTime: past.toISOString(), endTime: pastEnd.toISOString(), capacity: "2" })
    );

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireProviderMock).not.toHaveBeenCalled();
  });
});
