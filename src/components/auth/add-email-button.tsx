"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { requestEmailLink, verifyEmailLink, type EmailLinkErrorCode } from "@/lib/auth/link-email";

// AUTH-EMAIL-LINK-1 — the authenticated "Add email" action for the Settings
// "Sign-in methods" section. Two steps: enter a new email -> receive an OTP ->
// verify it. All authority is server-side (src/lib/auth/link-email.ts); this
// component never touches AuthUser.email. On success the server has attached the
// verified email to the SAME AuthUser, so a router.refresh() re-renders the
// section as "Connected".

const ERROR_KEY = {
  INVALID_EMAIL: "addEmailErrorInvalid",
  ACCOUNT_LINK_CONFLICT: "addEmailErrorConflict",
  ALREADY_HAS_EMAIL: "addEmailErrorAlready",
  RATE_LIMITED: "addEmailErrorRateLimited",
  INVALID_OTP: "addEmailErrorInvalidOtp",
  EMAIL_DELIVERY_UNAVAILABLE: "addEmailErrorUnavailable",
  NOT_AUTHENTICATED: "addEmailErrorGeneric",
  UNKNOWN_ERROR: "addEmailErrorGeneric",
} as const satisfies Record<EmailLinkErrorCode, string>;

type Step = "idle" | "email" | "code";

export function AddEmailButton() {
  const t = useTranslations("dashboard");
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const result = await requestEmailLink(email);
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
    const result = await verifyEmailLink(email, otp);
    if (result.ok) {
      router.refresh(); // server re-renders "Connected"
    } else {
      setError(t(ERROR_KEY[result.error]));
    }
    setLoading(false);
  }

  function reset() {
    setStep("idle");
    setEmail("");
    setOtp("");
    setError(null);
  }

  if (step === "idle") {
    return (
      <button
        type="button"
        onClick={() => setStep("email")}
        className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/20 focus:outline-none focus:ring-2 focus:ring-primary/20"
      >
        {t("addEmailButton")}
      </button>
    );
  }

  return (
    <div className="flex w-full flex-col items-stretch gap-2 sm:max-w-xs">
      {step === "email" ? (
        <form onSubmit={handleSend} className="flex flex-col gap-2">
          <label htmlFor="linkEmail" className="sr-only">
            {t("addEmailInputLabel")}
          </label>
          <input
            id="linkEmail"
            type="email"
            inputMode="email"
            autoComplete="email"
            dir="ltr"
            value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            placeholder={t("addEmailInputPlaceholder")}
            disabled={loading}
            className="h-11 rounded-xl border border-border bg-background/60 px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={loading || email.trim() === ""}
              className="inline-flex items-center rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading ? t("addEmailLoading") : t("addEmailSendButton")}
            </button>
            <button type="button" onClick={reset} className="text-sm text-foreground/60 hover:underline">
              {t("addEmailCancel")}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleVerify} className="flex flex-col gap-2">
          <label htmlFor="linkEmailOtp" className="sr-only">
            {t("addEmailOtpLabel")}
          </label>
          <input
            id="linkEmailOtp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            dir="ltr"
            value={otp}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOtp(e.target.value)}
            placeholder={t("addEmailOtpLabel")}
            disabled={loading}
            className="h-11 rounded-xl border border-border bg-background/60 px-3 text-center text-sm tracking-widest text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={loading || otp.trim() === ""}
              className="inline-flex items-center rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading ? t("addEmailLoading") : t("addEmailVerifyButton")}
            </button>
            <button type="button" onClick={reset} className="text-sm text-foreground/60 hover:underline">
              {t("addEmailCancel")}
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
