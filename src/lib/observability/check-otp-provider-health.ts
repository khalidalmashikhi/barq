import "server-only";
import { getOtpProvider } from "@/lib/otp/get-otp-provider";

// OTP provider health check — Production Hardening. Reuses the real
// provider factory (src/lib/otp/get-otp-provider.ts) as the single
// source of truth for "is this configuration valid" — getOtpProvider()
// already throws a clear error for an unknown provider name or a
// twilio selection missing its required credentials/channel, so this
// check needs no separate validation logic of its own.
//
// Returns only the resolved provider NAME (console/twilio), never a
// credential — safe for an unauthenticated public endpoint, same
// discipline as checkDatabaseHealth()'s "ok"/"error" (never the raw
// connection string or exception).

export type OtpProviderHealth = "console" | "twilio" | "disabled" | "misconfigured";

export function checkOtpProviderHealth(): OtpProviderHealth {
  try {
    getOtpProvider();
    // "disabled" is the staging-only mode (no OTP delivery); reported
    // honestly rather than masqueraded as "console". It is not
    // "misconfigured" — it constructs successfully and is an intended
    // staging state — so the /api/health check still treats it as healthy.
    if (process.env.OTP_PROVIDER === "twilio") return "twilio";
    if (process.env.OTP_PROVIDER === "disabled") return "disabled";
    return "console";
  } catch {
    return "misconfigured";
  }
}
