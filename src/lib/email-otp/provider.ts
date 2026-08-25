import "server-only";

// Email OTP delivery provider abstraction — AUTH-CUSTOMER-EMAIL-OTP.
//
// Mirrors src/lib/otp/provider.ts exactly (the phone OTP shape), adapted for
// email: an implementation receives an already-generated code (Better Auth's
// emailOTP plugin still generates + persists it) plus the delivery `type`, and
// only delivers it. Vendor selection is a config concern (get-email-provider.ts)
// only — nothing outside src/lib/email-otp/ imports a specific provider or
// references a vendor name.
//
// `type` is Better Auth's emailOTP delivery purpose. BARQ v1 only ever triggers
// "sign-in", but the field is carried through so a provider can vary copy later
// without an interface change.

export type EmailOtpType = "sign-in" | "email-verification" | "forget-password" | "change-email";

export interface EmailOtpSendParams {
  email: string;
  code: string;
  type: EmailOtpType;
}

export interface EmailOtpProvider {
  readonly name: string;
  send(params: EmailOtpSendParams): Promise<void>;
}
