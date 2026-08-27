"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { requestPhoneLink, verifyPhoneLink, type PhoneLinkErrorCode } from "@/lib/auth/link-phone";
import { assessIdentityConvergence, offerIdentityConvergence, convergeCustomerIdentityByPhone } from "@/lib/auth/identity-convergence";
import { PhoneNumberInput } from "./phone-number-input";
import { resolveAuthPhone, canRequestOtp } from "./phone-entry";
import { decideAfterConflict, clearedPhoneEntry, type AddPhoneStep } from "./phone-conflict-flow";
import { DEFAULT_COUNTRY, type Country } from "@/lib/countries/registry";

// AUTH-DUAL-VERIFICATION-1 / AUTH-INTERNATIONAL-PHONE-1 — the authenticated "Add
// phone" action (Settings + mandatory onboarding). Uses the shared country-flag +
// calling-code picker (PhoneNumberInput): the customer picks any country and enters
// the NATIONAL number, and resolveAuthPhone canonicalizes it to E.164 via the shared
// libphonenumber-js authority (Oman is the default, exactly like the login form). The
// server (link-phone.ts) re-normalizes as the authority and attaches the verified
// phone to the SAME AuthUser; this component never mutates AuthUser/User. On success
// router.refresh() re-renders (Settings shows "Connected"; onboarding advances).
//
// AUTH-IDENTITY-CONVERGENCE-1 — when the entered phone already belongs to another
// BARQ identity, the server returns ACCOUNT_LINK_CONFLICT (security guard). Instead of
// dead-ending, we assess (assessIdentityConvergence, server-side, NO OTP, no PII)
// whether this is a safe Customer-only case. If so the customer is shown THREE choices
// and NO OTP is sent yet: (1) verify ownership + converge — only this calls
// offerIdentityConvergence() to send the proof OTP, then convergeCustomerIdentityByPhone()
// unifies the identities; (2) use a different phone number — clears all pending
// phone/convergence/proof state and returns to the normal form, sending nothing and
// mutating nothing; (3) cancel. Blocked/privileged cases show a generic "contact
// support" message only — never any detail about the other account.

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

export function AddPhoneButton() {
  const t = useTranslations("dashboard");
  const router = useRouter();
  const [step, setStep] = useState<AddPhoneStep>("idle");
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
      setLoading(false);
      return;
    }

    // The phone belongs to another BARQ identity. Assess (server-side, NO OTP, no PII)
    // whether safe convergence is possible, then present the customer a choice. No OTP
    // is sent to the conflicted number here — only if they explicitly choose to verify.
    if (result.error === "ACCOUNT_LINK_CONFLICT") {
      const assessment = await assessIdentityConvergence(resolved.e164);
      const decision = decideAfterConflict(assessment.status);
      if (decision.kind === "step") {
        setSubmittedPhone(resolved.e164);
        setStep(decision.step);
      } else {
        setError(t(decision.errorKey));
      }
      setLoading(false);
      return;
    }

    setError(t(ERROR_KEY[result.error]));
    setLoading(false);
  }

  // Choice 1 — verify ownership and converge. This is the ONLY path that sends an OTP
  // to the conflicted number, and only on the customer's explicit consent.
  async function handleConvergeVerifyRequest() {
    setLoading(true);
    setError(null);
    const offer = await offerIdentityConvergence(submittedPhone);
    if (offer.status === "OWNERSHIP_VERIFICATION_REQUIRED") {
      setOtp("");
      setStep("convergeCode");
    } else if (offer.status === "SUPPORT_REQUIRED") {
      setStep("support");
    } else if (offer.status === "RATE_LIMITED") {
      setError(t("addPhoneErrorRateLimited"));
    } else if (offer.status === "OTP_DELIVERY_UNAVAILABLE") {
      setError(t("addPhoneErrorUnavailable"));
    } else {
      setError(t("addPhoneErrorGeneric"));
    }
    setLoading(false);
  }

  // Choice 2 — use a different phone number. Clears every pending phone / convergence /
  // proof value (no ACCOUNT_LINK_CONFLICT is retained) and returns to the normal Add
  // Phone form. Sends nothing and mutates nothing.
  function handleUseDifferentPhone() {
    const cleared = clearedPhoneEntry();
    setNationalNumber(cleared.nationalNumber);
    setSubmittedPhone(cleared.submittedPhone);
    setOtp(cleared.otp);
    setError(cleared.error);
    setCountry(DEFAULT_COUNTRY);
    setStep("phone");
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

  async function handleConverge(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const result = await convergeCustomerIdentityByPhone(submittedPhone, otp);
    if (result.ok) {
      setStep("converged");
    } else if (result.error === "SUPPORT_REQUIRED") {
      setStep("support");
    } else if (result.error === "INVALID_OTP") {
      setError(t("addPhoneErrorInvalidOtp"));
    } else if (result.error === "RATE_LIMITED") {
      setError(t("addPhoneErrorRateLimited"));
    } else {
      setError(t("addPhoneErrorGeneric"));
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
      {step === "phone" && (
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
      )}

      {step === "code" && (
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

      {step === "convergeChoice" && (
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t("convergeChoiceTitle")}</h3>
            <p className="mt-0.5 text-xs text-foreground/60">{t("convergeChoiceSubtitle")}</p>
          </div>
          <div className="flex flex-col items-stretch gap-2">
            <button
              type="button"
              onClick={handleConvergeVerifyRequest}
              disabled={loading}
              className="inline-flex items-center justify-center rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading ? t("addPhoneLoading") : t("convergeChoiceVerify")}
            </button>
            <button
              type="button"
              onClick={handleUseDifferentPhone}
              disabled={loading}
              className="inline-flex items-center justify-center rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/20 disabled:opacity-50"
            >
              {t("convergeChoiceDifferent")}
            </button>
            <button type="button" onClick={reset} disabled={loading} className="text-sm text-foreground/60 hover:underline">
              {t("addPhoneCancel")}
            </button>
          </div>
          {error && (
            <span role="alert" className="text-xs text-danger">
              {error}
            </span>
          )}
        </div>
      )}

      {step === "convergeCode" && (
        <form onSubmit={handleConverge} className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t("convergeTitle")}</h3>
            <p className="mt-0.5 text-xs text-foreground/60">{t("convergeSubtitle")}</p>
          </div>
          <label htmlFor="convergeOtp" className="sr-only">
            {t("addPhoneOtpLabel")}
          </label>
          <input
            id="convergeOtp"
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
              {loading ? t("addPhoneLoading") : t("convergeContinue")}
            </button>
            <button type="button" onClick={reset} className="text-sm text-foreground/60 hover:underline">
              {t("addPhoneCancel")}
            </button>
          </div>
        </form>
      )}

      {step === "converged" && (
        <div className="flex flex-col gap-3">
          <p role="status" className="text-sm font-medium text-foreground">
            {t("convergeSuccess")}
          </p>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="inline-flex w-fit items-center rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {t("convergeDone")}
          </button>
        </div>
      )}

      {step === "support" && (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-sm text-foreground/80">
            {t("convergeSupport")}
          </p>
          <button type="button" onClick={reset} className="w-fit text-sm text-foreground/60 hover:underline">
            {t("addPhoneCancel")}
          </button>
        </div>
      )}

      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
