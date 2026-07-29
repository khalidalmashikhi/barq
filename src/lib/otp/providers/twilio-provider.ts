import "server-only";
import type { OtpProvider, OtpSendParams } from "../provider";

// Twilio-backed OTP delivery (SMS or WhatsApp Business) — Phase D.4.
//
// Uses Twilio's plain REST Messages API via fetch (no new npm
// dependency, consistent with this codebase's minimal-dependency
// preference) rather than the `twilio` SDK. Supports WhatsApp by
// prefixing both the `To` and `From` numbers with `whatsapp:`, per
// Twilio's documented convention for its WhatsApp Business channel —
// switching channels is a config-only change (OTP_CHANNEL), not a
// code change.
//
// Never logs the auth token or the OTP code. On a non-2xx response,
// throws with Twilio's own error `code`/`message` (routing/API-level
// diagnostics — not a secret) so the caller can log a useful failure
// reason without the request body or credentials.

export type TwilioChannel = "sms" | "whatsapp";

export interface TwilioProviderConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  channel: TwilioChannel;
}

function toChannelAddress(rawNumber: string, channel: TwilioChannel): string {
  return channel === "whatsapp" ? `whatsapp:${rawNumber}` : rawNumber;
}

export class TwilioOtpProvider implements OtpProvider {
  readonly name = "twilio";

  constructor(private readonly config: TwilioProviderConfig) {}

  async send({ phoneNumber, code }: OtpSendParams): Promise<void> {
    const { accountSid, authToken, fromNumber, channel } = this.config;

    const body = new URLSearchParams({
      To: toChannelAddress(phoneNumber, channel),
      From: toChannelAddress(fromNumber, channel),
      Body: `Your BARQ verification code is ${code}. It expires shortly. Do not share this code.`,
    });

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as { code?: number; message?: string } | null;
      throw new Error(
        `TwilioOtpProvider: delivery failed (HTTP ${response.status}${
          errorBody?.code ? `, Twilio error ${errorBody.code}` : ""
        }${errorBody?.message ? `: ${errorBody.message}` : ""})`
      );
    }
  }
}
