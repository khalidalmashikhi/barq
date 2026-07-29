import "server-only";

// OTP delivery provider abstraction — Phase D.4 (Production OTP Integration).
//
// Mirrors the exact shape of Better Auth's own `phoneNumber` plugin
// `sendOTP` callback (`{ phoneNumber, code } -> Promise<void>`) rather
// than inventing a new shape, so any implementation can be wired
// directly into src/lib/auth/server.ts's `sendOTP` with no adapter
// layer. Vendor selection is a config concern (get-otp-provider.ts)
// only — nothing outside src/lib/otp/ ever imports a specific
// provider or references a vendor name.

export interface OtpSendParams {
  phoneNumber: string;
  code: string;
}

export interface OtpProvider {
  readonly name: string;
  send(params: OtpSendParams): Promise<void>;
}
