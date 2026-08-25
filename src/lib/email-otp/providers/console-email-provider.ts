import "server-only";
import type { EmailOtpProvider, EmailOtpSendParams } from "../provider";

// Development-only email OTP delivery — AUTH-CUSTOMER-EMAIL-OTP.
//
// Mirrors src/lib/otp/providers/console-provider.ts: prints the code to the
// server terminal only, never to any client-visible response or production log
// line, so a developer can exercise the email sign-in flow locally without a real
// email vendor. Refuses to run in production so it can never become an accidental
// real delivery channel for a live OTP — also independently enforced at startup
// by scripts/env-schema.ts, which fails production validation if
// EMAIL_OTP_PROVIDER resolves to "console".

export class ConsoleEmailProvider implements EmailOtpProvider {
  readonly name = "console";

  async send({ email, code, type }: EmailOtpSendParams): Promise<void> {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "ConsoleEmailProvider: no production email delivery is configured. " +
          "This development-only console delivery must not run in production."
      );
    }

    console.log(`[DEV EMAIL OTP] ${email} (${type}) -> ${code}`);
  }
}
