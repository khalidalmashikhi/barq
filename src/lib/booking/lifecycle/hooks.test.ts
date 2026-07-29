import { describe, it, expect, vi } from "vitest";

// Phase E.1 — regression tests for the lifecycle hook dispatcher: the
// correct stub is registered for the correct toStatus, no hook is
// registered for CREATED (there is no "onCreated" — creation isn't a
// transition, see record-booking-created.ts), and a throwing hook is
// caught/logged rather than propagated (future hooks may call real
// external services that can fail; that must never appear to undo an
// already-committed transition).
//
// Uses dispatchLifecycleHook's injectable `registry` parameter rather
// than vi.spyOn on the named onXxx exports: those are direct,
// same-module function bindings, so spying on the exported property
// does not affect dispatchLifecycleHook's own internal calls (verified
// empirically — that approach silently fails with zero call count).

vi.mock("server-only", () => ({}));

// Phase 4.1: onPendingProvider/onAccepted/onRejected/onCancelled now
// call notifyBookingEvent()/resolveBookingParties() (see notify.ts) —
// mocked here so these hook-dispatch tests stay focused on dispatch
// behavior, not notification content (see notify.test.ts for that).
vi.mock("./notify", () => ({
  notifyBookingEvent: vi.fn().mockResolvedValue(undefined),
  resolveBookingParties: vi.fn().mockResolvedValue({ customerUserId: "user-customer-1", providerUserId: "user-provider-1" }),
}));

const {
  dispatchLifecycleHook,
  HOOKS,
  onPendingProvider,
  onAccepted,
  onRejected,
  onInProgress,
  onCompleted,
  onCancelled,
  onDisputed,
  onExpired,
} = await import("./hooks");

const baseCtx = {
  bookingId: "booking-1",
  customerId: "customer-1",
  providerId: "provider-1",
  serviceId: "service-1",
  fromStatus: "CREATED" as const,
};

describe("HOOKS registry — mapping correctness", () => {
  it("maps each status to its documented hook, by reference", () => {
    expect(HOOKS.PENDING_PROVIDER).toBe(onPendingProvider);
    expect(HOOKS.CONFIRMED).toBe(onAccepted);
    expect(HOOKS.IN_PROGRESS).toBe(onInProgress);
    expect(HOOKS.COMPLETED).toBe(onCompleted);
    expect(HOOKS.CANCELLED).toBe(onCancelled);
    expect(HOOKS.REJECTED).toBe(onRejected);
    expect(HOOKS.DISPUTED).toBe(onDisputed);
    expect(HOOKS.EXPIRED).toBe(onExpired);
  });

  it("has no entry for CREATED — creation is not a transition", () => {
    expect(HOOKS.CREATED).toBeUndefined();
  });
});

describe("onPendingProvider / onAccepted / onRejected / onCancelled — notification wiring", () => {
  it("onPendingProvider notifies the provider's user", async () => {
    const { notifyBookingEvent } = await import("./notify");
    await onPendingProvider({ ...baseCtx, toStatus: "PENDING_PROVIDER" });
    expect(notifyBookingEvent).toHaveBeenCalledWith({
      userId: "user-provider-1",
      bookingId: "booking-1",
      kind: "PENDING_PROVIDER",
    });
  });

  it("onAccepted notifies the customer's user", async () => {
    const { notifyBookingEvent } = await import("./notify");
    await onAccepted({ ...baseCtx, toStatus: "CONFIRMED" });
    expect(notifyBookingEvent).toHaveBeenCalledWith({
      userId: "user-customer-1",
      bookingId: "booking-1",
      kind: "BOOKING_ACCEPTED",
    });
  });

  it("onAccepted ALSO notifies the provider's own user with their confirmation receipt", async () => {
    const { notifyBookingEvent } = await import("./notify");
    await onAccepted({ ...baseCtx, toStatus: "CONFIRMED" });
    expect(notifyBookingEvent).toHaveBeenCalledWith({
      userId: "user-provider-1",
      bookingId: "booking-1",
      kind: "PROVIDER_BOOKING_CONFIRMED",
    });
  });

  it("onRejected notifies the customer's user", async () => {
    const { notifyBookingEvent } = await import("./notify");
    await onRejected({ ...baseCtx, toStatus: "REJECTED" });
    expect(notifyBookingEvent).toHaveBeenCalledWith({
      userId: "user-customer-1",
      bookingId: "booking-1",
      kind: "BOOKING_REJECTED",
    });
  });

  it("onRejected ALSO notifies the provider's own user with their rejection receipt", async () => {
    const { notifyBookingEvent } = await import("./notify");
    await onRejected({ ...baseCtx, toStatus: "REJECTED" });
    expect(notifyBookingEvent).toHaveBeenCalledWith({
      userId: "user-provider-1",
      bookingId: "booking-1",
      kind: "PROVIDER_BOOKING_REJECTED",
    });
  });

  it("onCancelled notifies both the customer's and the provider's user", async () => {
    const { notifyBookingEvent } = await import("./notify");
    await onCancelled({ ...baseCtx, toStatus: "CANCELLED" });
    expect(notifyBookingEvent).toHaveBeenCalledWith({
      userId: "user-customer-1",
      bookingId: "booking-1",
      kind: "BOOKING_CANCELLED",
    });
    expect(notifyBookingEvent).toHaveBeenCalledWith({
      userId: "user-provider-1",
      bookingId: "booking-1",
      kind: "BOOKING_CANCELLED_BY_CUSTOMER",
    });
  });

  it("onExpired notifies both the customer's and the provider's user", async () => {
    const { notifyBookingEvent } = await import("./notify");
    await onExpired({ ...baseCtx, toStatus: "EXPIRED" });
    expect(notifyBookingEvent).toHaveBeenCalledWith({
      userId: "user-customer-1",
      bookingId: "booking-1",
      kind: "BOOKING_EXPIRED",
    });
    expect(notifyBookingEvent).toHaveBeenCalledWith({
      userId: "user-provider-1",
      bookingId: "booking-1",
      kind: "BOOKING_EXPIRED",
    });
  });
});

describe("dispatchLifecycleHook", () => {
  it("invokes the registered hook for a known status", async () => {
    const hook = vi.fn().mockResolvedValue(undefined);
    await dispatchLifecycleHook({ ...baseCtx, toStatus: "CONFIRMED" }, { CONFIRMED: hook });

    expect(hook).toHaveBeenCalledWith(expect.objectContaining({ toStatus: "CONFIRMED", bookingId: "booking-1" }));
  });

  it("does nothing for a status with no registered hook", async () => {
    await expect(dispatchLifecycleHook({ ...baseCtx, toStatus: "CANCELLED" }, {})).resolves.toBeUndefined();
  });

  it("does not throw when a hook rejects — logs and swallows instead", async () => {
    const hook = vi.fn().mockRejectedValue(new Error("downstream service unavailable"));

    await expect(
      dispatchLifecycleHook({ ...baseCtx, toStatus: "CONFIRMED" }, { CONFIRMED: hook })
    ).resolves.toBeUndefined();
    expect(hook).toHaveBeenCalledTimes(1);
  });
});
