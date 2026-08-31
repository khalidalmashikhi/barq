import "server-only";

// BOOKING NOTIFICATION DELIVERY — the transactional-booking-email provider switch, SEPARATE from
// the OTP email switch (§6/§10). Staging must never start sending live booking mail merely because
// OTP Resend credentials happen to be present, so booking email has its OWN flag that defaults to
// "disabled". It reuses the same RESEND_API_KEY / EMAIL_FROM secrets as OTP but is gated
// independently. Mirrors the email-otp config convention (read env at call time, fail-closed).

export type BookingEmailProvider =
  | { kind: "disabled" }
  | { kind: "console" }
  | { kind: "resend"; apiKey: string; from: string };

/**
 * Resolve the booking-email provider from env. Default "disabled" → no external send is attempted
 * (the delivery worker no-ops), so a deployment with OTP Resend creds but no explicit booking-email
 * opt-in never sends booking mail. "resend" requires RESEND_API_KEY + EMAIL_FROM; if either is
 * missing it fails closed to "disabled" (never throws in a booking path). "console" logs only (dev).
 */
export function getBookingEmailProvider(): BookingEmailProvider {
  const kind = (process.env.BOOKING_EMAIL_PROVIDER ?? "disabled").toLowerCase();
  if (kind === "console") return { kind: "console" };
  if (kind === "resend") {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (apiKey && from) return { kind: "resend", apiKey, from };
    return { kind: "disabled" }; // misconfigured → fail closed, never send half-configured
  }
  return { kind: "disabled" };
}

/** Is booking email actually deliverable right now? (console counts — it "delivers" to the log.) */
export function isBookingEmailEnabled(): boolean {
  return getBookingEmailProvider().kind !== "disabled";
}
