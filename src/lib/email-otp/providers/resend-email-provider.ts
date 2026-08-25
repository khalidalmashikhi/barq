import "server-only";
import type { EmailOtpProvider, EmailOtpSendParams } from "../provider";
import { buildBarqOtpEmail } from "../email-template";

// Resend-backed email OTP delivery — AUTH-EMAIL-VENDOR-1, the first real email
// vendor. Mirrors src/lib/otp/providers/twilio-provider.ts exactly: calls the
// vendor's plain HTTP API via fetch (NO `resend` npm dependency — consistent with
// this codebase's minimal-dependency preference), config injected from env, and
// server-only so the API key never reaches the client.
//
// SECURITY: never logs the API key or the OTP code. On a non-2xx response it
// throws with Resend's own error name/message (routing/API-level diagnostics — not
// a secret and not the recipient/code) so the caller can log a useful failure
// reason. Fails closed: any delivery failure throws, so emailOTP's
// sendVerificationOTP rethrows and the caller is never falsely told "sent".

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface ResendProviderConfig {
  apiKey: string;
  /** Verified Resend sender, e.g. "BARQ <noreply@barq.example>". */
  from: string;
}

export class ResendEmailProvider implements EmailOtpProvider {
  readonly name = "resend";

  constructor(private readonly config: ResendProviderConfig) {}

  async send({ email, code }: EmailOtpSendParams): Promise<void> {
    const { subject, text, html } = buildBarqOtpEmail(code);

    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.config.from,
        to: [email],
        subject,
        text,
        html,
      }),
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as { name?: string; message?: string } | null;
      // Never include the api key, the OTP, or the recipient in the thrown message.
      throw new Error(
        `ResendEmailProvider: delivery failed (HTTP ${response.status}${
          errorBody?.name ? `, ${errorBody.name}` : ""
        }${errorBody?.message ? `: ${errorBody.message}` : ""})`
      );
    }
  }
}
