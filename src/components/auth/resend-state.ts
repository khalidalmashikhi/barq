// Pure OTP-resend UI logic, split out of login-form.tsx so the cooldown/
// disabled/error rules are unit-testable without rendering the client form.
// These are UX rules only — the real cooldown + daily cap are enforced
// server-side (src/lib/otp/*); this just reflects them in the button.

export type ResendButtonLabel = "loading" | "cooldown" | "idle";

export type ResendButtonState = {
  disabled: boolean;
  label: ResendButtonLabel;
};

// The Resend button is disabled while a resend is in flight, while the
// cooldown is still counting down, or while an OTP verification is in
// progress. The visible label reflects, in priority order: resending →
// cooldown countdown → ready.
export function getResendButtonState(input: {
  cooldownSeconds: number;
  resending: boolean;
  verifying: boolean;
}): ResendButtonState {
  const disabled = input.cooldownSeconds > 0 || input.resending || input.verifying;
  const label: ResendButtonLabel = input.resending ? "loading" : input.cooldownSeconds > 0 ? "cooldown" : "idle";
  return { disabled, label };
}

export type ResendErrorKey = "resendRateLimited" | "otpUnavailable" | "genericError";

// Map a Better Auth error code from a resend attempt to the auth-namespace
// translation key to show. TOO_MANY_REQUESTS is the server cooldown/daily-cap
// rejection; OTP_DELIVERY_UNAVAILABLE is the staging fail-closed case.
export function resendErrorKey(code: string | undefined): ResendErrorKey {
  if (code === "TOO_MANY_REQUESTS") return "resendRateLimited";
  if (code === "OTP_DELIVERY_UNAVAILABLE") return "otpUnavailable";
  return "genericError";
}
