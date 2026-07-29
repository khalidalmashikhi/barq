import "server-only";
import type { OtpProvider, OtpSendParams } from "../provider";

// Development-only OTP delivery — extracted, byte-for-byte identical
// behavior to what previously lived inline in src/lib/auth/server.ts
// (Engineering Sprint 2). Prints the OTP to the server terminal only,
// never to any client-visible response or production log line. Refuses
// to run in production so this can never become an accidental real
// delivery channel for a live OTP (SECURITY.md's "never log sensitive
// data" anti-pattern) — this is also independently enforced at startup
// by scripts/env-schema.ts, which fails production validation if
// OTP_PROVIDER resolves to "console".

export class ConsoleOtpProvider implements OtpProvider {
  readonly name = "console";

  async send({ phoneNumber, code }: OtpSendParams): Promise<void> {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "ConsoleOtpProvider: no production SMS/WhatsApp delivery is configured. " +
          "This development-only console delivery must not run in production."
      );
    }

    console.log(`[DEV OTP] ${phoneNumber} -> ${code}`);
  }
}
