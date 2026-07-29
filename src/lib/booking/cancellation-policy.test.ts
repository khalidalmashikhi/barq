import { describe, it, expect, vi } from "vitest";

// Phase E.1 — regression test confirming canCancelBooking's result is
// unchanged after being refactored to delegate to the lifecycle
// engine's transition matrix (src/lib/booking/lifecycle/transitions.ts)
// instead of maintaining its own separate status list.

vi.mock("server-only", () => ({}));

const { canCancelBooking, canAcceptBooking, canRejectBooking, canStartBooking, canCompleteBooking, canReviewBooking } =
  await import("./cancellation-policy");

describe("canCancelBooking", () => {
  // Phase 4.1: CREATED is now a momentary status that immediately
  // advances to PENDING_PROVIDER (see create-booking.ts) — cancellable
  // statuses shifted from CREATED to PENDING_PROVIDER accordingly,
  // preserving the same real-world capability (cancel a request that
  // hasn't been confirmed yet).
  it("is true for PENDING_PROVIDER and CONFIRMED", () => {
    expect(canCancelBooking("PENDING_PROVIDER")).toBe(true);
    expect(canCancelBooking("CONFIRMED")).toBe(true);
  });

  it("is false for CREATED, IN_PROGRESS, COMPLETED, CANCELLED, REJECTED, and DISPUTED", () => {
    expect(canCancelBooking("CREATED")).toBe(false);
    expect(canCancelBooking("IN_PROGRESS")).toBe(false);
    expect(canCancelBooking("COMPLETED")).toBe(false);
    expect(canCancelBooking("CANCELLED")).toBe(false);
    expect(canCancelBooking("REJECTED")).toBe(false);
    expect(canCancelBooking("DISPUTED")).toBe(false);
  });
});

describe("canAcceptBooking", () => {
  it("is true only for PENDING_PROVIDER", () => {
    expect(canAcceptBooking("PENDING_PROVIDER")).toBe(true);
  });

  it("is false for every other status", () => {
    expect(canAcceptBooking("CREATED")).toBe(false);
    expect(canAcceptBooking("CONFIRMED")).toBe(false);
    expect(canAcceptBooking("IN_PROGRESS")).toBe(false);
    expect(canAcceptBooking("COMPLETED")).toBe(false);
    expect(canAcceptBooking("CANCELLED")).toBe(false);
    expect(canAcceptBooking("REJECTED")).toBe(false);
    expect(canAcceptBooking("DISPUTED")).toBe(false);
  });
});

describe("canRejectBooking", () => {
  it("is true only for PENDING_PROVIDER", () => {
    expect(canRejectBooking("PENDING_PROVIDER")).toBe(true);
  });

  it("is false for every other status", () => {
    expect(canRejectBooking("CREATED")).toBe(false);
    expect(canRejectBooking("CONFIRMED")).toBe(false);
    expect(canRejectBooking("IN_PROGRESS")).toBe(false);
    expect(canRejectBooking("COMPLETED")).toBe(false);
    expect(canRejectBooking("CANCELLED")).toBe(false);
    expect(canRejectBooking("REJECTED")).toBe(false);
    expect(canRejectBooking("DISPUTED")).toBe(false);
  });
});

describe("canStartBooking", () => {
  it("is true only for CONFIRMED", () => {
    expect(canStartBooking("CONFIRMED")).toBe(true);
  });

  it("is false for every other status", () => {
    expect(canStartBooking("CREATED")).toBe(false);
    expect(canStartBooking("PENDING_PROVIDER")).toBe(false);
    expect(canStartBooking("IN_PROGRESS")).toBe(false);
    expect(canStartBooking("COMPLETED")).toBe(false);
    expect(canStartBooking("CANCELLED")).toBe(false);
    expect(canStartBooking("REJECTED")).toBe(false);
    expect(canStartBooking("DISPUTED")).toBe(false);
  });
});

describe("canCompleteBooking", () => {
  it("is true only for IN_PROGRESS", () => {
    expect(canCompleteBooking("IN_PROGRESS")).toBe(true);
  });

  it("is false for every other status", () => {
    expect(canCompleteBooking("CREATED")).toBe(false);
    expect(canCompleteBooking("PENDING_PROVIDER")).toBe(false);
    expect(canCompleteBooking("CONFIRMED")).toBe(false);
    expect(canCompleteBooking("COMPLETED")).toBe(false);
    expect(canCompleteBooking("CANCELLED")).toBe(false);
    expect(canCompleteBooking("REJECTED")).toBe(false);
    expect(canCompleteBooking("DISPUTED")).toBe(false);
  });
});

describe("canReviewBooking", () => {
  it("is true only for COMPLETED", () => {
    expect(canReviewBooking("COMPLETED")).toBe(true);
  });

  it("is false for every other status", () => {
    expect(canReviewBooking("CREATED")).toBe(false);
    expect(canReviewBooking("PENDING_PROVIDER")).toBe(false);
    expect(canReviewBooking("CONFIRMED")).toBe(false);
    expect(canReviewBooking("IN_PROGRESS")).toBe(false);
    expect(canReviewBooking("CANCELLED")).toBe(false);
    expect(canReviewBooking("REJECTED")).toBe(false);
    expect(canReviewBooking("DISPUTED")).toBe(false);
    expect(canReviewBooking("EXPIRED")).toBe(false);
  });
});
