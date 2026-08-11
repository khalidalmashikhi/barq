import { describe, it, expect } from "vitest";
import { getResendButtonState, resendErrorKey } from "./resend-state";

describe("getResendButtonState", () => {
  it("is disabled and shows the countdown during cooldown", () => {
    expect(getResendButtonState({ cooldownSeconds: 25, resending: false, verifying: false })).toEqual({
      disabled: true,
      label: "cooldown",
    });
  });

  it("is enabled and ready once the cooldown reaches 0", () => {
    expect(getResendButtonState({ cooldownSeconds: 0, resending: false, verifying: false })).toEqual({
      disabled: false,
      label: "idle",
    });
  });

  it("is disabled and shows loading while a resend is in flight", () => {
    expect(getResendButtonState({ cooldownSeconds: 0, resending: true, verifying: false })).toEqual({
      disabled: true,
      label: "loading",
    });
  });

  it("is disabled while an OTP verification is in progress", () => {
    expect(getResendButtonState({ cooldownSeconds: 0, resending: false, verifying: true }).disabled).toBe(true);
  });
});

describe("resendErrorKey", () => {
  it("maps the server cooldown/daily-cap rejection to the rate-limit message", () => {
    expect(resendErrorKey("TOO_MANY_REQUESTS")).toBe("resendRateLimited");
  });

  it("maps the delivery-unavailable (staging fail-closed) case", () => {
    expect(resendErrorKey("OTP_DELIVERY_UNAVAILABLE")).toBe("otpUnavailable");
  });

  it("falls back to the generic error for unknown/undefined codes", () => {
    expect(resendErrorKey(undefined)).toBe("genericError");
    expect(resendErrorKey("SOMETHING_ELSE")).toBe("genericError");
  });
});
