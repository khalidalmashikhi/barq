import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 5.2 (Production Hardening) — regression test for
// recordAuditEvent(): it's a thin, deterministic mapping from params to
// a single tx.auditLog.create(...) call — the interesting behavior (that
// it's always called INSIDE the same transaction as the mutation it
// describes) is covered by each call site's own test, not here.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: {} }));

const createMock = vi.fn();
const fakeTx = { auditLog: { create: (...args: unknown[]) => createMock(...args) } } as never;

const { recordAuditEvent } = await import("./record-audit-event");

afterEach(() => {
  createMock.mockReset();
});

describe("recordAuditEvent", () => {
  it("writes a single AuditLog row with the given fields", async () => {
    await recordAuditEvent(
      {
        actorType: "ADMIN",
        actorId: "admin-1",
        action: "provider.approved",
        entityType: "Provider",
        entityId: "provider-1",
        previousValue: { status: "APPLIED" },
        newValue: { status: "APPROVED" },
      },
      fakeTx
    );

    expect(createMock).toHaveBeenCalledWith({
      data: {
        actorType: "ADMIN",
        actorId: "admin-1",
        action: "provider.approved",
        entityType: "Provider",
        entityId: "provider-1",
        previousValue: { status: "APPLIED" },
        newValue: { status: "APPROVED" },
      },
    });
  });

  it("omits previousValue/newValue as undefined when not provided", async () => {
    await recordAuditEvent(
      { actorType: "SYSTEM", actorId: null, action: "availability.bulk_created", entityType: "Availability", entityId: "service-1" },
      fakeTx
    );

    expect(createMock).toHaveBeenCalledWith({
      data: {
        actorType: "SYSTEM",
        actorId: null,
        action: "availability.bulk_created",
        entityType: "Availability",
        entityId: "service-1",
        previousValue: undefined,
        newValue: undefined,
      },
    });
  });
});
