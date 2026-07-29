import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 2.17 (Payment Webhook Foundation) — integration test composing
// two real, unmocked entry points into the same Payment against a
// shared in-memory fake Prisma store: capturePayment() (Phase 2.16, the
// synchronous admin-invoked path) and processPaymentWebhookEvent() (this
// phase's asynchronous provider-invoked path). Same rationale as
// price-domain.integration.test.ts/service-domain.integration.test.ts:
// every existing test in this codebase mocks @/lib/db rather than
// connecting to a real database, and CI runs against a placeholder
// DATABASE_URL with no Postgres behind it.
//
// This is the concrete proof that the two entry points converge safely
// on one Payment lifecycle rather than racing or double-processing it —
// exactly the property a Payment Webhook Foundation exists to guarantee
// once a real gateway starts delivering asynchronous notifications
// alongside an admin's own synchronous capture action.
//
// Phase 2.25 (Payment Idempotency & Capture Safety) added updateMany()
// to the fake payment store below, alongside the pre-existing update()
// (still used by processPaymentWebhookEvent(), unchanged this phase) —
// capturePayment() now writes through an atomic conditional updateMany()
// guarded by status instead.

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ admin: { id: "admin-1" } }),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const captureMock = vi.fn();

vi.mock("@/lib/payments/gateway/get-payment-gateway-provider", () => ({
  getPaymentGatewayProvider: () => ({ capture: (...args: unknown[]) => captureMock(...args) }),
}));

type FakePayment = { id: string; bookingId: string; status: string; capturedAt: Date | null };

let store: Map<string, FakePayment>;
let byBooking: Map<string, string>;
let auditLog: Array<{ action: string; actorType: string; entityId: string }>;

vi.mock("@/lib/db", () => ({
  prisma: {
    payment: {
      findUnique: async ({ where }: { where: { id?: string; bookingId?: string } }) => {
        const id = where.id ?? (where.bookingId ? byBooking.get(where.bookingId) : undefined);
        return id ? (store.get(id) ?? null) : null;
      },
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        payment: {
          update: async ({ where, data }: { where: { id: string }; data: Partial<FakePayment> }) => {
            const existing = store.get(where.id);
            if (!existing) throw new Error("not found");
            const updated = { ...existing, ...data };
            store.set(where.id, updated);
            return updated;
          },
          // Phase 2.25 (Payment Idempotency & Capture Safety) —
          // capturePayment() now writes via an atomic conditional
          // updateMany() guarded by status. This fake mirrors real
          // Postgres semantics: the write only applies if the row's
          // current status still matches the guard.
          updateMany: async ({
            where,
            data,
          }: {
            where: { id: string; status?: string };
            data: Partial<FakePayment>;
          }) => {
            const existing = store.get(where.id);
            if (!existing || (where.status !== undefined && existing.status !== where.status)) {
              return { count: 0 };
            }
            store.set(where.id, { ...existing, ...data });
            return { count: 1 };
          },
        },
        auditLog: {
          create: async ({ data }: { data: { action: string; actorType: string; entityId: string } }) => {
            auditLog.push({ action: data.action, actorType: data.actorType, entityId: data.entityId });
            return {};
          },
        },
      }),
  },
}));

const { capturePayment } = await import("@/lib/admin/capture-payment");
const { processPaymentWebhookEvent } = await import("./process-payment-webhook-event");

const PAYMENT_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
const BOOKING_ID = "019f4e4e-8116-7052-b15e-000000000001";

beforeEach(() => {
  store = new Map([[PAYMENT_ID, { id: PAYMENT_ID, bookingId: BOOKING_ID, status: "INITIATED", capturedAt: null }]]);
  byBooking = new Map([[BOOKING_ID, PAYMENT_ID]]);
  auditLog = [];
  captureMock.mockReset();
});

describe("Payment domain integration (admin capture + webhook processing converge on one Payment)", () => {
  it("captures via the admin action, then a later webhook redelivery for the same booking is a safe no-op", async () => {
    captureMock.mockResolvedValue({ status: "CAPTURED", occurredAt: new Date("2026-01-01T00:00:00.000Z") });

    const adminResult = await capturePayment(PAYMENT_ID);
    expect(adminResult).toEqual({ ok: true });
    expect(store.get(PAYMENT_ID)?.status).toBe("CAPTURED");

    const webhookResult = await processPaymentWebhookEvent({
      providerKey: "NONE",
      providerEventId: "evt_1",
      bookingId: BOOKING_ID,
      status: "CAPTURED",
      occurredAt: new Date(),
    });

    expect(webhookResult).toEqual({ ok: true, applied: false, reason: "ALREADY_PROCESSED" });
    expect(auditLog).toHaveLength(1);
  });

  it("captures via a webhook event first, then the admin action can no longer capture it", async () => {
    const webhookResult = await processPaymentWebhookEvent({
      providerKey: "NONE",
      providerEventId: "evt_2",
      bookingId: BOOKING_ID,
      status: "CAPTURED",
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(webhookResult).toEqual({ ok: true, applied: true });
    expect(store.get(PAYMENT_ID)?.status).toBe("CAPTURED");

    const adminResult = await capturePayment(PAYMENT_ID);

    expect(adminResult).toEqual({ ok: false, error: "PAYMENT_NOT_CAPTURABLE" });
    expect(captureMock).not.toHaveBeenCalled();
    expect(auditLog).toHaveLength(1);
  });

  it("a webhook reporting FAILED for a still-INITIATED payment marks it FAILED with no capturedAt", async () => {
    const result = await processPaymentWebhookEvent({
      providerKey: "NONE",
      providerEventId: "evt_3",
      bookingId: BOOKING_ID,
      status: "FAILED",
      occurredAt: new Date(),
    });

    expect(result).toEqual({ ok: true, applied: true });
    expect(store.get(PAYMENT_ID)).toMatchObject({ status: "FAILED", capturedAt: null });
  });
});
