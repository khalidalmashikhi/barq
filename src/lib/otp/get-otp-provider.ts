import "server-only";
import type { OtpProvider } from "./provider";
import { ConsoleOtpProvider } from "./providers/console-provider";
import { DisabledOtpProvider } from "./providers/disabled-provider";
import { TwilioOtpProvider, type TwilioChannel } from "./providers/twilio-provider";

// Provider factory — Phase D.4. The ONLY place in the application that
// selects a vendor by name; everything else (src/lib/auth/server.ts)
// depends only on the OtpProvider interface. Switching providers is a
// configuration change (OTP_PROVIDER) only, per this phase's explicit
// objective — no code path outside this file branches on vendor name.
//
// Not memoized: env vars are only read at process start in this
// codebase's deployment model, and constructing a provider is cheap
// (no I/O) — a fresh instance per call keeps this function trivially
// testable via vi.stubEnv without needing a reset hook.

export function getOtpProvider(): OtpProvider {
  const providerName = process.env.OTP_PROVIDER || "console";

  switch (providerName) {
    case "console":
      return new ConsoleOtpProvider();

    // Staging-only mode (OTP_PROVIDER=disabled, gated to APP_ENV=staging by
    // scripts/env-schema.ts). Constructs successfully so the app can boot,
    // but every send() fails closed — see providers/disabled-provider.ts.
    case "disabled":
      return new DisabledOtpProvider();

    case "twilio": {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const fromNumber = process.env.TWILIO_FROM_NUMBER;
      const channel = (process.env.OTP_CHANNEL || "sms") as TwilioChannel;

      if (!accountSid || !authToken || !fromNumber) {
        throw new Error(
          "getOtpProvider: OTP_PROVIDER=twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER to be set."
        );
      }
      if (channel !== "sms" && channel !== "whatsapp") {
        throw new Error(`getOtpProvider: OTP_CHANNEL must be "sms" or "whatsapp" if set (got: "${channel}")`);
      }

      return new TwilioOtpProvider({ accountSid, authToken, fromNumber, channel });
    }

    default:
      throw new Error(`getOtpProvider: unknown OTP_PROVIDER "${providerName}" (expected "console", "twilio", or "disabled")`);
  }
}
