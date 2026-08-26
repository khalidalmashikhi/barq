"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { requestPhoneLink, verifyPhoneLink, type PhoneLinkErrorCode } from "@/lib/auth/link-phone";

// AUTH-DUAL-IDENTITY-1 — the authenticated "Add phone" action for the Settings
// "Sign-in methods" section (mirror of add-email-button.tsx). Two steps: enter an
// Oman number -> receive an OTP -> verify. All authority is server-side
// (src/lib/auth/link-phone.ts); this component never mutates AuthUser/User. On
// success the phone is attached to the SAME account, so router.refresh() re-renders
// the section as "Connected". The server canonicalizes the number (Oman-only), so a
// plain input is sufficient.

const ERROR_KEY = {
  INVALID_PHONE: "addPhoneErrorInvalid",
  ACCOUNT_LINK_CONFLICT: "addPhoneErrorConflict",
  ALREADY_HAS_PHONE: "addPhoneErrorAlready",
  RATE_LIMITED: "addPhoneErrorRateLimited",
  INVALID_OTP: "addPhoneErrorInvalidOtp",
  OTP_DELIVERY_UNAVAILABLE: "addPhoneErrorUnavailable",
  NOT_AUTHENTICATED: "addPhoneErrorGeneric",
  UNKNOWN_ERROR: "addPhoneErrorGeneric",
} as const satisfies Record<PhoneLinkErrorCode, string>;

type Step = "idle" | "phone" | "code";

export function AddPhoneButton() {
  const t = useTranslations("dashboard");
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const result = await requestPhoneLink(phone);
    if (result.ok) {
      setStep("code");
    } else {
      setError(t(ERROR_KEY[result.error]));
    }
    setLoading(false);
  }

  async function handleVerify(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const result = await verifyPhoneLink(phone, otp);
    if (result.ok) {
      router.refresh();
    } else {
      setError(t(ERROR_KEY[result.error]));
    }
    setLoading(false);
  }

  function reset() {
    setStep("idle");
    setPhone("");
    setOtp("");
    setError(null);
  }

  if (step === "idle") {
    return (
      <button
        type="button"
        onClick={() => setStep("phone")}
        className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/20 focus:outline-none focus:ring-2 focus:ring-primary/20"
      >
        {t("addPhoneButton")}
      </button>
    );
  }

  return (
    <div className="flex w-full flex-col items-stretch gap-2 sm:max-w-xs">
      {step === "phone" ? (
        <form onSubmit={handleSend} className="flex flex-col gap-2">
          <label htmlFor="linkPhone" className="sr-only">
            {t("addPhoneInputLabel")}
          </label>
          <input
            id="linkPhone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            value={phone}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
            placeholder={t("addPhoneInputPlaceholder")}
            disabled={loading}
            className="h-11 rounded-xl border border-border bg-background/60 px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={loading || phone.trim() === ""}
              className="inline-flex items-center rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading ? t("addPhoneLoading") : t("addPhoneSendButton")}
            </button>
            <button type="button" onClick={reset} className="text-sm text-foreground/60 hover:underline">
              {t("addPhoneCancel")}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleVerify} className="flex flex-col gap-2">
          <label htmlFor="linkPhoneOtp" className="sr-only">
            {t("addPhoneOtpLabel")}
          </label>
          <input
            id="linkPhoneOtp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            dir="ltr"
            value={otp}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOtp(e.target.value)}
            placeholder={t("addPhoneOtpLabel")}
            disabled={loading}
            className="h-11 rounded-xl border border-border bg-background/60 px-3 text-center text-sm tracking-widest text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={loading || otp.trim() === ""}
              className="inline-flex items-center rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading ? t("addPhoneLoading") : t("addPhoneVerifyButton")}
            </button>
            <button type="button" onClick={reset} className="text-sm text-foreground/60 hover:underline">
              {t("addPhoneCancel")}
            </button>
          </div>
        </form>
      )}

      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
