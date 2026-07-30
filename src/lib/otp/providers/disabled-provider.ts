import "server-only";
import type { OtpProvider } from "../provider";

// Disabled OTP delivery — fix(deploy): allow disabled OTP delivery in staging.
//
// Selected ONLY when OTP_PROVIDER=disabled, which scripts/env-schema.ts
// permits solely when APP_ENV=staging — never in production, and never as a
// silent default. It exists so a staging deployment can boot under
// NODE_ENV=production before a real OTP vendor (Twilio) is provisioned,
// without weakening authentication.
//
// FAIL CLOSED, BY DESIGN: send() always rejects. It takes no `code` argument
// at all (the OtpProvider interface allows an implementation that ignores
// params), so it can never generate, print, log, persist, or expose an OTP,
// and never pretends an SMS was sent. Because every send fails, Better Auth's
// send-otp request errors out and no OTP is ever issued or verifiable — there
// is no bypass and authentication is not weakened: with this provider, nobody
// can log in at all. The thrown error carries only a stable, machine-readable
// `code` (never the OTP, never a secret) for the auth layer to surface as a
// localized "delivery unavailable" message.

export class OtpDeliveryUnavailableError extends Error {
  readonly code = "OTP_DELIVERY_UNAVAILABLE";

  constructor() {
    super("OTP delivery is unavailable in this environment.");
    this.name = "OtpDeliveryUnavailableError";
  }
}

export class DisabledOtpProvider implements OtpProvider {
  readonly name = "disabled";

  async send(): Promise<void> {
    throw new OtpDeliveryUnavailableError();
  }
}
