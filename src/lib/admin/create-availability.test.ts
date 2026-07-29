import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.7 (Availability Foundation) — regression tests for
// createAvailability(), the admin-initiated slot creation path.

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

const serviceFindUniqueMock = vi.fn();
const availabilityCreateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    service: {
      findUnique: (...args: unknown[]) => serviceFindUniqueMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        availability: { create: (...args: unknown[]) => availabilityCreateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { createAvailability } = await import("./create-availability");

const SERVICE_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

function baseFields(overrides: Record<string, string> = {}) {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    serviceId: SERVICE_ID,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    capacity: "5",
    ...overrides,
  };
}

afterEach(() => {
  requireAdminMock.mockReset();
  serviceFindUniqueMock.mockReset();
  availabilityCreateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("createAvailability", () => {
  it("returns INVALID_INPUT for a malformed serviceId without checking admin status", async () => {
    const result = await createAvailability(buildFormData(baseFields({ serviceId: "not-a-uuid" })));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT when endTime is before startTime", async () => {
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() - 1000);
    const result = await createAvailability(
      buildFormData(baseFields({ startTime: start.toISOString(), endTime: end.toISOString() }))
    );

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT when startTime is in the past", async () => {
    const start = new Date(Date.now() - 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const result = await createAvailability(
      buildFormData(baseFields({ startTime: start.toISOString(), endTime: end.toISOString() }))
    );

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("returns INVALID_INPUT for a zero or negative capacity", async () => {
    const result = await createAvailability(buildFormData(baseFields({ capacity: "0" })));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("returns NO_ADMIN_PROFILE when the caller has no Admin profile", async () => {
    const { ForbiddenError } = await import("@/lib/auth");
    requireAdminMock.mockRejectedValue(new ForbiddenError("Admin role required"));

    const result = await createAvailability(buildFormData(baseFields()));

    expect(result).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
    expect(availabilityCreateMock).not.toHaveBeenCalled();
  });

  it("returns SERVICE_NOT_FOUND when the service doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    serviceFindUniqueMock.mockResolvedValue(null);

    const result = await createAvailability(buildFormData(baseFields()));

    expect(result).toEqual({ ok: false, error: "SERVICE_NOT_FOUND" });
    expect(availabilityCreateMock).not.toHaveBeenCalled();
  });

  it("creates the slot OPEN and records an audit event", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    serviceFindUniqueMock.mockResolvedValue({ id: SERVICE_ID });
    availabilityCreateMock.mockResolvedValue({ id: "slot-1" });
    auditCreateMock.mockResolvedValue({});

    const result = await createAvailability(buildFormData(baseFields()));

    expect(result).toEqual({ ok: true, slotId: "slot-1" });
    expect(availabilityCreateMock).toHaveBeenCalled();
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "ADMIN",
        actorId: "admin-1",
        action: "availability.slot_created",
        entityType: "Availability",
        entityId: "slot-1",
      }),
    });
  });
});
