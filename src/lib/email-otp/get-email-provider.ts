import "server-only";
import type { EmailOtpProvider } from "./provider";
import { ConsoleEmailProvider } from "./providers/console-email-provider";
import { DisabledEmailProvider } from "./providers/disabled-email-provider";
import { ResendEmailProvider } from "./providers/resend-email-provider";

// Email OTP provider factory — AUTH-CUSTOMER-EMAIL-OTP, extended by
// AUTH-EMAIL-VENDOR-1 with Resend. Mirrors src/lib/otp/get-otp-provider.ts: the
// ONLY place that selects an email vendor by name; everything else depends only on
// the EmailOtpProvider interface. Switching vendors is a config change
// (EMAIL_OTP_PROVIDER) only — no code path outside this file branches on vendor.
//
// FAIL-CLOSED / INERT BY DEFAULT: with EMAIL_OTP_PROVIDER unset or "disabled",
// this returns the DisabledEmailProvider (every send throws), so email OTP is
// dormant until an email vendor is actually provisioned — matching the OTP
// (Twilio) and media (Supabase) "inert until provisioned" precedents. "resend"
// activates real delivery, but ONLY on a deployment that sets EMAIL_OTP_PROVIDER
// plus its credentials; that env change is out of scope for this gate.
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

    // AUTH-EMAIL-VENDOR-1 — the first real vendor. Requires both credentials
    // (env-schema.ts also enforces this all-or-nothing rule at startup).
    case "resend": {
      const apiKey = process.env.RESEND_API_KEY;
      const from = process.env.EMAIL_FROM;
      if (!apiKey || !from) {
        throw new Error(
          "getEmailOtpProvider: EMAIL_OTP_PROVIDER=resend requires RESEND_API_KEY and EMAIL_FROM to be set."
        );
      }
      return new ResendEmailProvider({ apiKey, from });
    }

    default:
      throw new Error(
        `getEmailOtpProvider: unknown EMAIL_OTP_PROVIDER "${providerName}" (expected "console", "resend", or "disabled")`
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
  // A provider that can actually deliver: dev "console" or the real "resend"
  // vendor. "disabled"/unset stay inert (feature hidden). Note this only reflects
  // the selected provider name; the resend branch's credential completeness is
  // enforced at startup by env-schema.ts, so a misconfigured resend never boots.
  return providerName === "console" || providerName === "resend";
}
