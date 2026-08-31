import { describe, it, expect } from "vitest";
import { buildBookingEmail, isBookingEmailKind, type BookingEmailKind } from "./booking-email-content";
import { locales } from "@/i18n/locales";

// BOOKING NOTIFICATION DELIVERY — the pure content renderer. Pins: all 8 locales render, RTL for
// Arabic, defaultLocale fallback for an unknown locale, canonical link present, no payment words,
// HTML-escaping of dynamic facts, and optional when/total rows.

const KINDS: BookingEmailKind[] = [
  "PENDING_PROVIDER",
  "BOOKING_ACCEPTED",
  "BOOKING_REJECTED",
  "BOOKING_CANCELLED",
  "BOOKING_CANCELLED_BY_CUSTOMER",
  "BOOKING_EXPIRED",
  "BOOKING_STARTED",
  "BOOKING_COMPLETED",
];

const FACTS = {
  serviceName: "Desert Safari",
  bookingUrl: "https://barq.example/en/bookings/019f4e4e-8116-7052-b15e-b79b5ccb1af9",
  whenText: "Mon, 1 June, 09:00",
  totalText: "50.00 OMR",
};

describe("buildBookingEmail", () => {
  it("renders a non-empty subject/html/text for every kind in every one of the 8 locales", () => {
    for (const locale of locales) {
      for (const kind of KINDS) {
        const { subject, html, text } = buildBookingEmail({ kind, locale, facts: FACTS });
        expect(subject.trim().length).toBeGreaterThan(0);
        expect(html).toContain("BARQ");
        expect(html).toContain(FACTS.bookingUrl);
        expect(text).toContain(FACTS.bookingUrl);
        expect(text).toContain(FACTS.serviceName);
      }
    }
  });

  it("Arabic renders RTL and uses the برق brand in the footer (never بارق)", () => {
    const { html } = buildBookingEmail({ kind: "BOOKING_ACCEPTED", locale: "ar", facts: FACTS });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("برق");
    expect(html).not.toContain("بارق");
  });

  it("non-Arabic locales render LTR", () => {
    for (const locale of ["en", "de", "fr", "it", "pl", "ru", "cs"] as const) {
      expect(buildBookingEmail({ kind: "BOOKING_ACCEPTED", locale, facts: FACTS }).html).toContain('dir="ltr"');
    }
  });

  it("an unknown/unsupported locale falls back to the default locale (Arabic), never throws or blanks", () => {
    const { subject, html } = buildBookingEmail({ kind: "BOOKING_ACCEPTED", locale: "es", facts: FACTS });
    expect(subject).toBe(buildBookingEmail({ kind: "BOOKING_ACCEPTED", locale: "ar", facts: FACTS }).subject);
    expect(html).toContain('dir="rtl"');
  });

  it("contains NO payment vocabulary (payment is NONE)", () => {
    for (const locale of locales) {
      for (const kind of KINDS) {
        const { subject, html, text } = buildBookingEmail({ kind, locale, facts: FACTS });
        const blob = `${subject} ${html} ${text}`.toLowerCase();
        for (const banned of ["paid", "charged", "payment successful", "invoice", "receipt"]) {
          expect(blob).not.toContain(banned);
        }
      }
    }
  });

  it("HTML-escapes a service name containing markup (no injection)", () => {
    const { html } = buildBookingEmail({
      kind: "BOOKING_ACCEPTED",
      locale: "en",
      facts: { ...FACTS, serviceName: '<script>alert("x")</script>' },
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("omits the when/total rows when not provided", () => {
    const { text } = buildBookingEmail({
      kind: "BOOKING_EXPIRED",
      locale: "en",
      facts: { serviceName: "X", bookingUrl: FACTS.bookingUrl },
    });
    expect(text).not.toContain("When:");
    expect(text).not.toContain("Total:");
    expect(text).toContain("Service: X");
  });

  it("isBookingEmailKind narrows only the renderable kinds", () => {
    for (const k of KINDS) expect(isBookingEmailKind(k)).toBe(true);
    for (const k of ["PROVIDER_BOOKING_CONFIRMED", "NEW_REVIEW_RECEIVED", "nonsense"]) {
      expect(isBookingEmailKind(k)).toBe(false);
    }
  });

  // COMPLETION & REVIEW LOOP — the completion email invites a review; the started email uses the
  // plain view-booking CTA. Both link to the CUSTOMER booking detail (never a special review token).
  it("the completion email uses the review CTA in every locale, and it differs from the plain view CTA", () => {
    for (const locale of locales) {
      const completed = buildBookingEmail({ kind: "BOOKING_COMPLETED", locale, facts: FACTS });
      const started = buildBookingEmail({ kind: "BOOKING_STARTED", locale, facts: FACTS });
      // The review CTA text is distinct from the started/view-booking CTA text.
      expect(completed.html).not.toBe(started.html);
      // Both still point at the same canonical customer booking URL (no special review link).
      expect(completed.html).toContain(FACTS.bookingUrl);
      expect(started.html).toContain(FACTS.bookingUrl);
    }
  });
});
