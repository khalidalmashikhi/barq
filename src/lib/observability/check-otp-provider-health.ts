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

export type OtpProviderHealth = "console" | "twilio" | "misconfigured";

export function checkOtpProviderHealth(): OtpProviderHealth {
  try {
    getOtpProvider();
    return process.env.OTP_PROVIDER === "twilio" ? "twilio" : "console";
  } catch {
    return "misconfigured";
  }
}
