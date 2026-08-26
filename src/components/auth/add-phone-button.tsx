"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { requestPhoneLink, verifyPhoneLink, type PhoneLinkErrorCode } from "@/lib/auth/link-phone";
import { PhoneNumberInput } from "./phone-number-input";
import { resolveAuthPhone, canRequestOtp } from "./phone-entry";
import { DEFAULT_COUNTRY, type Country } from "@/lib/countries/registry";

// AUTH-DUAL-VERIFICATION-1 / AUTH-INTERNATIONAL-PHONE-1 — the authenticated "Add
// phone" action (Settings + mandatory onboarding). Uses the shared country-flag +
// calling-code picker (PhoneNumberInput): the customer picks any country and enters
// the NATIONAL number, and resolveAuthPhone canonicalizes it to E.164 via the shared
// libphonenumber-js authority (Oman is the default, exactly like the login form). The
// server (link-phone.ts) re-normalizes as the authority and attaches the verified
// phone to the SAME AuthUser; this component never mutates AuthUser/User. On success
// router.refresh() re-renders (Settings shows "Connected"; onboarding advances).

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
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [nationalNumber, setNationalNumber] = useState("");
  const [submittedPhone, setSubmittedPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // Resolve (country + national input) to canonical E.164 BEFORE any request; an
    // unsupported country / invalid number never reaches the server.
    const resolved = resolveAuthPhone(country, nationalNumber);
    if (!resolved.ok) {
      setError(t("addPhoneErrorInvalid"));
      return;
    }

    setLoading(true);
    const result = await requestPhoneLink(resolved.e164);
    if (result.ok) {
      setSubmittedPhone(resolved.e164);
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
    const result = await verifyPhoneLink(submittedPhone, otp);
    if (result.ok) {
      router.refresh();
    } else {
      setError(t(ERROR_KEY[result.error]));
    }
    setLoading(false);
  }

  function reset() {
    setStep("idle");
    setNationalNumber("");
    setSubmittedPhone("");
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
    <div className="flex w-full flex-col items-stretch gap-2 sm:max-w-sm">
      {step === "phone" ? (
        <form onSubmit={handleSend} className="flex flex-col gap-2">
          <label htmlFor="linkPhone" className="text-xs font-medium text-foreground/70">
            {t("addPhoneInputLabel")}
          </label>
          <PhoneNumberInput
            country={country}
            nationalNumber={nationalNumber}
            onCountryChange={setCountry}
            onNationalNumberChange={setNationalNumber}
            disabled={loading}
            inputId="linkPhone"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={loading || !canRequestOtp(country, nationalNumber)}
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
