import { describe, it, expect } from "vitest";
import { CalendarPlus, CalendarCheck, XCircle, XOctagon, Clock, Star, Bell } from "lucide-react";
import { getNotificationPresentation } from "./notification-presentation";

// Notification presentation consolidation — Provider Notifications &
// Operational Alerts phase. Confirms every real BookingNotificationKind
// (src/lib/booking/lifecycle/notify.ts) maps to a distinct, correct
// icon/badge, and that an unknown or missing kind (undefined —
// historical rows written before this phase, or rows from a different
// module like contract execution's own notify.ts) falls back safely
// rather than guessing or throwing.

describe("getNotificationPresentation", () => {
  it.each([
    ["PENDING_PROVIDER", CalendarPlus, "info", "categoryNew"],
    ["BOOKING_ACCEPTED", CalendarCheck, "success", "categoryConfirmed"],
    ["PROVIDER_BOOKING_CONFIRMED", CalendarCheck, "success", "categoryConfirmed"],
    ["BOOKING_REJECTED", XCircle, "danger", "categoryRejected"],
    ["PROVIDER_BOOKING_REJECTED", XCircle, "default", "categoryRejected"],
    ["BOOKING_CANCELLED", XOctagon, "warning", "categoryCancelled"],
    ["BOOKING_CANCELLED_BY_CUSTOMER", XOctagon, "warning", "categoryCancelled"],
    ["BOOKING_EXPIRED", Clock, "warning", "categoryExpired"],
    ["NEW_REVIEW_RECEIVED", Star, "success", "categoryReview"],
  ] as const)("maps kind %s to the correct icon/badge/category", (kind, Icon, badgeVariant, categoryKey) => {
    const presentation = getNotificationPresentation(kind);
    expect(presentation.Icon).toBe(Icon);
    expect(presentation.badgeVariant).toBe(badgeVariant);
    expect(presentation.categoryKey).toBe(categoryKey);
  });

  it("falls back to a safe generic presentation for undefined kind (historical rows)", () => {
    const presentation = getNotificationPresentation(undefined);
    expect(presentation).toEqual({ Icon: Bell, badgeVariant: "default", categoryKey: "categoryGeneral" });
  });

  it("falls back to a safe generic presentation for an unrecognized kind string (e.g. a contract-execution kind)", () => {
    const presentation = getNotificationPresentation("SIGN_REMINDER");
    expect(presentation).toEqual({ Icon: Bell, badgeVariant: "default", categoryKey: "categoryGeneral" });
  });

  it("never throws for an empty string kind", () => {
    expect(() => getNotificationPresentation("")).not.toThrow();
    expect(getNotificationPresentation("").categoryKey).toBe("categoryGeneral");
  });
});
