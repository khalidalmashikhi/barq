import "server-only";
import type { EmailOtpProvider } from "../provider";

// Disabled email OTP delivery — AUTH-CUSTOMER-EMAIL-OTP.
//
// The DEFAULT provider whenever EMAIL_OTP_PROVIDER is unset or "disabled"
// (fail-closed). BARQ ships email OTP INERT: no email vendor is provisioned yet,
// so out of the box email sign-in cannot send and is not offered to users
// (isEmailOtpConfigured() returns false — see get-email-provider.ts).
//
// FAIL CLOSED, BY DESIGN: send() always rejects. It takes no arguments, so it can
// never generate, print, log, persist, or expose an OTP, and never pretends an
// email was sent. Because every send fails, Better Auth's send-verification-otp
// request errors out and no email OTP is ever issued or verifiable — there is no
// bypass and authentication is not weakened. The thrown error carries only a
// stable, machine-readable `code` (never the OTP, never a secret) for the auth
// layer to surface as a localized "delivery unavailable" message. Mirrors
// src/lib/otp/providers/disabled-provider.ts.

export class EmailDeliveryUnavailableError extends Error {
  readonly code = "EMAIL_DELIVERY_UNAVAILABLE";

  constructor() {
    super("Email OTP delivery is unavailable in this environment.");
    this.name = "EmailDeliveryUnavailableError";
  }
}

export class DisabledEmailProvider implements EmailOtpProvider {
  readonly name = "disabled";

  async send(): Promise<void> {
    throw new EmailDeliveryUnavailableError();
  }
}
