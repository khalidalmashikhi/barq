"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { requestPhoneLink, verifyPhoneLink, type PhoneLinkErrorCode } from "@/lib/auth/link-phone";
import { assessIdentityLink, offerIdentityLink, completeIdentityLink } from "@/lib/auth/provider-link-orchestration";
import { PhoneNumberInput } from "./phone-number-input";
import { resolveAuthPhone, canRequestOtp } from "./phone-entry";
import { decideAfterConflict, decideAfterOffer, decideAfterComplete, clearedPhoneEntry, type AddPhoneStep } from "./phone-conflict-flow";
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
// AUTH-IDENTITY-CONVERGENCE-1 / AUTH-PROVIDER-LINK gate 3B — when the entered phone
// already belongs to another BARQ identity, the server returns ACCOUNT_LINK_CONFLICT
// (security guard). Instead of dead-ending, we assess through the UNIFIED orchestration
// (assessIdentityLink, server-side, NO OTP, no PII) whether a safe link is available. An
// eligible customer convergence and an eligible provider credential link are
// INDISTINGUISHABLE here — the same generic three-choice screen is shown and NO OTP is
// sent yet: (1) send code and link — only this calls offerIdentityLink() to send the
// proof OTP and returns an opaque attemptId, then completeIdentityLink(attemptId, code)
// performs the correct DISTINCT mutation server-side; (2) use a different phone number —
// clears every pending phone/attempt/OTP value; (3) cancel. On success a customer
// convergence stays signed in (`converged`), while a provider link retires the current
// identity and asks the user to sign in again (`reauth`) — the only point the two routes
// visibly differ. Blocked/privileged cases show a generic "contact support" message only,
// never any detail about the other account. The browser never receives owner id / survivor
// id / privilege / account type — only the opaque attemptId (held in component state).

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
  // The opaque proof handle returned by offerIdentityLink. Held ONLY in component state —
  // never in the URL, query, or localStorage, and it carries no owner/survivor/role data.
  const [attemptId, setAttemptId] = useState("");
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
      const assessment = await assessIdentityLink(resolved.e164);
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

  // Choice 1 (and resend) — consent to prove ownership and link. This is the ONLY path
  // that sends an OTP to the conflicted number, and only on the customer's explicit
  // consent. Each call mints a FRESH challenge; we always replace the stored attemptId
  // (a resend never reuses a consumed/expired one). Reveals nothing about the other
  // account (customer vs provider is indistinguishable here).
  async function handleOfferLink() {
    setLoading(true);
    setError(null);
    setAttemptId("");
    const offer = await offerIdentityLink(submittedPhone);
    if (offer.status === "OWNERSHIP_VERIFICATION_REQUIRED") setAttemptId(offer.attemptId);
    const decision = decideAfterOffer(offer.status);
    if (decision.kind === "step") {
      if (decision.step === "convergeCode") setOtp("");
      setStep(decision.step);
    } else {
      setError(t(decision.errorKey));
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
    setAttemptId(cleared.attemptId);
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
    if (loading) return; // guard against a duplicate submit while a completion is pending
    setLoading(true);
    setError(null);
    // Completion is bound to the opaque attemptId + the code ONLY — the phone is never
    // resubmitted as authority; the server re-derives P/owner/purpose from the challenge.
    const result = await completeIdentityLink(attemptId, otp);
    const decision = decideAfterComplete(result);
    if (decision.kind === "step") {
      if (decision.step === "reauth" || decision.step === "converged") setAttemptId("");
      setStep(decision.step);
    } else {
      setError(t(decision.errorKey));
    }
    setLoading(false);
  }

  // Provider-link success: the current identity was retired and its sessions invalidated by
  // the transaction, so there is NO session to keep. Clear local state and return to the
  // normal login entry — never auto-route to a Provider dashboard and never impersonate the
  // surviving account. Post-login role/profile routing resolves the destination.
  function handleReauth() {
    reset();
    router.push("/login");
  }

  function reset() {
    setStep("idle");
    setNationalNumber("");
    setSubmittedPhone("");
    setAttemptId("");
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
              onClick={handleOfferLink}
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
            <button
              type="button"
              onClick={handleOfferLink}
              disabled={loading}
              className="text-sm text-foreground/60 hover:underline disabled:opacity-50"
            >
              {t("convergeResend")}
            </button>
            <button type="button" onClick={reset} className="text-sm text-foreground/60 hover:underline">
              {t("addPhoneCancel")}
            </button>
          </div>
        </form>
      )}

      {step === "reauth" && (
        <div className="flex flex-col gap-3">
          <p role="status" className="text-sm font-medium text-foreground">
            {t("linkReauthMessage")}
          </p>
          <button
            type="button"
            onClick={handleReauth}
            className="inline-flex w-fit items-center rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {t("linkReauthButton")}
          </button>
        </div>
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
