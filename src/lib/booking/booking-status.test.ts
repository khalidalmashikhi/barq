import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getBookingStatusLabel, getBookingStatusStyle } = await import("./booking-status");

// Phase 5.1 (Production Readiness) — regression tests for the
// localization fix: getBookingStatusLabel() previously returned a
// hardcoded Arabic string for every locale; it now resolves a
// translation key through the caller's own translator. These tests
// stub a translator (a simple key-echoing function) rather than
// exercising real next-intl message resolution, matching how other
// translation-key-mapping functions in this codebase are tested (see
// service-action-errors's own precedent).

const stubTranslator = (key: string) => `translated:${key}`;

describe("getBookingStatusLabel", () => {
  it("resolves the correct translation key for every known status, including EXPIRED", () => {
    expect(getBookingStatusLabel("CREATED", stubTranslator)).toBe("translated:statusCreated");
    expect(getBookingStatusLabel("PENDING_PROVIDER", stubTranslator)).toBe("translated:statusPendingProvider");
    expect(getBookingStatusLabel("CONFIRMED", stubTranslator)).toBe("translated:statusConfirmed");
    expect(getBookingStatusLabel("IN_PROGRESS", stubTranslator)).toBe("translated:statusInProgress");
    expect(getBookingStatusLabel("COMPLETED", stubTranslator)).toBe("translated:statusCompleted");
    expect(getBookingStatusLabel("CANCELLED", stubTranslator)).toBe("translated:statusCancelled");
    expect(getBookingStatusLabel("REJECTED", stubTranslator)).toBe("translated:statusRejected");
    expect(getBookingStatusLabel("DISPUTED", stubTranslator)).toBe("translated:statusDisputed");
    expect(getBookingStatusLabel("EXPIRED", stubTranslator)).toBe("translated:statusExpired");
  });

  it("falls back to the raw status string for an unrecognized value, without calling the translator", () => {
    const t = vi.fn(stubTranslator);
    expect(getBookingStatusLabel("SOME_FUTURE_STATUS", t)).toBe("SOME_FUTURE_STATUS");
    expect(t).not.toHaveBeenCalled();
  });
});

describe("getBookingStatusStyle", () => {
  it("returns a real style for EXPIRED, grouped with the other negative terminal outcomes", () => {
    expect(getBookingStatusStyle("EXPIRED")).toBe(getBookingStatusStyle("REJECTED"));
  });

  it("falls back to the neutral badge class for an unrecognized value", () => {
    expect(getBookingStatusStyle("SOME_FUTURE_STATUS")).toBe("bg-accent/20 text-accent-foreground");
  });
});
