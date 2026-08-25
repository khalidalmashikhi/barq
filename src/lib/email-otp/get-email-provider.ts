import "server-only";
import type { EmailOtpProvider } from "./provider";
import { ConsoleEmailProvider } from "./providers/console-email-provider";
import { DisabledEmailProvider } from "./providers/disabled-email-provider";

// Email OTP provider factory — AUTH-CUSTOMER-EMAIL-OTP. Mirrors
// src/lib/otp/get-otp-provider.ts: the ONLY place that selects an email vendor by
// name; everything else depends only on the EmailOtpProvider interface.
//
// FAIL-CLOSED / INERT BY DEFAULT: with EMAIL_OTP_PROVIDER unset or "disabled",
// this returns the DisabledEmailProvider (every send throws), so email OTP is
// dormant until an email vendor is actually provisioned — matching the OTP
// (Twilio) and media (Supabase) "inert until provisioned" precedents. No real
// email vendor is wired yet; adding one (e.g. "resend") is a future,
// dependency-approving gate that adds a case here plus its credentials.
//
// Not memoized (same reasoning as get-otp-provider.ts): env is read at process
// start and construction is cheap and I/O-free, keeping this trivially testable.

export function getEmailOtpProvider(): EmailOtpProvider {
  const providerName = process.env.EMAIL_OTP_PROVIDER || "disabled";

  switch (providerName) {
    // Development-only: prints the code to the server terminal. env-schema.ts
    // forbids this in production.
    case "console":
      return new ConsoleEmailProvider();

    // Explicit (or defaulted) off switch — fail-closed, cannot send.
    case "disabled":
      return new DisabledEmailProvider();

    default:
      throw new Error(
        `getEmailOtpProvider: unknown EMAIL_OTP_PROVIDER "${providerName}" (expected "console" or "disabled"; no email vendor is wired yet)`
      );
  }
}

/**
 * Whether email OTP sign-in is available on THIS deployment — true only when
 * EMAIL_OTP_PROVIDER is set to a provider that can actually deliver. Used
 * server-side to decide whether to render the "Continue with email" UI (the
 * boolean is passed to the client as a prop). Mirrors isGoogleConfigured():
 * fail-closed, so the option never appears while email is inert.
 */
export function isEmailOtpConfigured(): boolean {
  const providerName = process.env.EMAIL_OTP_PROVIDER;
  return providerName === "console";
}
