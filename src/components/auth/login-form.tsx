"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { GoogleIcon } from "@/components/ui/google-icon";
import { getResendButtonState, resendErrorKey } from "./resend-state";
import {
  OTP_LENGTH,
  emptyOtp,
  setOtpDigit,
  nextIndexAfterEntry,
  prevIndexOnBackspace,
  parseOtpPaste,
} from "./otp-input";

// Login form — Engineering Sprint 3 (Phone OTP UI), redesigned by the
// Visual Identity Sprint.
//
// PRESERVED EXACTLY, UNCHANGED FROM THE PRIOR VERSION: the two-step
// state machine (phone -> otp), the authClient.phoneNumber.sendOtp/
// verify calls and their exact argument shapes, all loading/error/
// success state variables, the redirect-to-/dashboard success path, and
// the "change phone number" reset behavior. Only the JSX/visual layer
// and the OTP input's *interaction* changed — see below.
//
// CHANGED: the OTP entry step now uses 6 individual digit boxes
// (auto-advancing focus, backspace-to-previous, paste support) instead
// of one free-text input, per the brief's explicit "OTP input boxes"
// request. The 6 digit values are joined into the exact same `otp`
// string that was always passed to `verify({ phoneNumber, code: otp })`
// — the backend call is byte-for-byte identical to before.
//
// INTERNATIONALIZATION PHASE A.3: every string previously read from
// strings.ts's flat `t` object now comes from next-intl's "auth"
// namespace via useTranslations() — a mechanical migration only, no
// wording changed, no key renamed beyond dropping strings.ts's flat
// naming in favor of namespaced access (t.loginTitle -> t("loginTitle"),
// etc.). ar/en values in messages/{ar,en}/auth.json are copied verbatim
// from strings.ts. Server Action calls, state machine, and OTP
// interaction are untouched.
//
// PHASE B GROUP 1: useRouter now comes from @/i18n/navigation instead
// of next/navigation — /dashboard moved under [locale] in this same
// group, and the locale-aware router.push("/dashboard") auto-prepends
// whichever locale this form is currently rendered under, rather than
// navigating to a now-dead unprefixed path.

// OTP_LENGTH and the digit-box value logic now live in ./otp-input.ts (pure,
// unit-tested). The component keeps ownership of React state, refs, and focus.

// Mirrors the server's OTP_RESEND_COOLDOWN_SECONDS default (src/lib/otp/
// otp-config.ts). This is a client-side UX countdown only — the server-side
// cooldown + daily cap remain the real enforcement; if the server rejects a
// too-early/over-limit resend, we surface its localized message.
const RESEND_COOLDOWN_SECONDS = 30;

type Step = "phone" | "otp";

// Google is an ADDITIONAL sign-in method — the phone+OTP flow below is
// preserved exactly. `googleEnabled` comes from the server (only true when both
// Google credentials are configured); the credentials themselves never reach
// the client. `oauthError` is set when Better Auth redirected back here after a
// failed Google attempt.
export function LoginForm({ googleEnabled = false, oauthError = false }: { googleEnabled?: boolean; oauthError?: boolean }) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("auth");
  const [step, setStep] = useState<Step>("phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otpDigits, setOtpDigits] = useState<string[]>(emptyOtp());
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(oauthError ? t("oauthError") : null);
  const [otpSent, setOtpSent] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendNotice, setResendNotice] = useState(false);
  const otpInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const otp = otpDigits.join("");

  // Tick the resend cooldown down to 0 (client-side UX only).
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    setError(null);
    try {
      // callbackURL / errorCallbackURL are FIXED internal, locale-prefixed paths
      // (never user input) — no open-redirect surface. On success the browser is
      // redirected to Google, so nothing after this runs.
      const { error: socialError } = await authClient.signIn.social({
        provider: "google",
        callbackURL: `/${locale}/dashboard`,
        errorCallbackURL: `/${locale}/login?error=oauth`,
      });
      if (socialError) {
        setError(t("oauthError"));
        setGoogleLoading(false);
      }
    } catch {
      setError(t("oauthError"));
      setGoogleLoading(false);
    }
  }

  async function handleRequestOtp(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error: requestError } = await authClient.phoneNumber.sendOtp({
        phoneNumber,
      });

      if (requestError) {
        // OTP_PROVIDER=disabled (staging) fails closed with a stable,
        // machine-readable code (src/lib/auth/server.ts). Show a clear,
        // specific localized message for that case; fall back to the generic
        // error for anything else.
        const code = (requestError as { code?: string }).code;
        setError(code === "OTP_DELIVERY_UNAVAILABLE" ? t("otpUnavailable") : t("genericError"));
        return;
      }

      setOtpSent(true);
      setResendNotice(false);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setStep("otp");
    } catch {
      setError(t("genericError"));
    } finally {
      setLoading(false);
    }
  }

  async function handleResendOtp() {
    if (resendCooldown > 0 || resending || loading) return;
    setResending(true);
    setError(null);
    setResendNotice(false);

    try {
      const { error: requestError } = await authClient.phoneNumber.sendOtp({ phoneNumber });

      if (requestError) {
        // The same server-side cooldown/daily-cap that protects the initial
        // send also protects resend — surface its specific reason when known.
        const code = (requestError as { code?: string }).code;
        setError(t(resendErrorKey(code)));
        return;
      }

      // BUG-2 fix: a resend issues a NEW code, so any digits the user already
      // typed are now stale. Clear the boxes and return focus to the first one so
      // they enter the new code from a clean state (previously the old digits
      // remained, and — with the boxes full — the newly typed code was ignored).
      setResendNotice(true);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setOtpDigits(emptyOtp());
      otpInputRefs.current[0]?.focus();
    } catch {
      setError(t("genericError"));
    } finally {
      setResending(false);
    }
  }

  async function handleVerifyOtp(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error: verifyError } = await authClient.phoneNumber.verify({
        phoneNumber,
        code: otp,
      });

      if (verifyError) {
        // BUG-3 fix: a verify failure at this step is (essentially always) an
        // incorrect or expired code — the phone is already validated. Surface a
        // specific, actionable message instead of the generic "something went
        // wrong". This is a CLIENT MESSAGE ONLY: the verify call, its arguments,
        // OTP semantics, expiry, and rate limits are unchanged.
        setError(t("invalidOtpError"));
        return;
      }

      router.push("/dashboard", { locale });
      router.refresh();
    } catch {
      setError(t("genericError"));
    } finally {
      setLoading(false);
    }
  }

  function handleChangePhoneNumber() {
    setStep("phone");
    setOtpDigits(emptyOtp());
    setOtpSent(false);
    setResendNotice(false);
    setResendCooldown(0);
    setError(null);
  }

  function handleOtpDigitChange(index: number, value: string) {
    const next = setOtpDigit(otpDigits, index, value);
    setOtpDigits(next);

    const focusIndex = nextIndexAfterEntry(index, next[index]!, OTP_LENGTH);
    if (focusIndex !== null) {
      otpInputRefs.current[focusIndex]?.focus();
    }
  }

  function handleOtpKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Backspace") return;
    const focusIndex = prevIndexOnBackspace(otpDigits, index);
    if (focusIndex !== null) {
      otpInputRefs.current[focusIndex]?.focus();
    }
  }

  function handleOtpPaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const parsed = parseOtpPaste(event.clipboardData.getData("text"), OTP_LENGTH);
    if (!parsed) return;
    event.preventDefault();
    setOtpDigits(parsed.digits);
    otpInputRefs.current[parsed.focusIndex]?.focus();
  }

  return (
    <Card
      className="w-full max-w-md border-white/60 bg-glass shadow-premium-lg animate-fade-up"
      hoverLift={false}
    >
      <h1 className="text-2xl font-semibold text-foreground">{t("loginTitle")}</h1>
      <p className="mt-1.5 text-sm text-foreground/60">{t("loginSubtitle")}</p>

      {googleEnabled && (
        <div className="mt-8 flex flex-col gap-5">
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={googleLoading || loading}
            className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-border bg-background/60 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent/20 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
          >
            <GoogleIcon size={18} />
            {googleLoading ? t("loading") : t("continueWithGoogle")}
          </button>

          {/* Divider: Google is one option; phone + OTP remains fully available. */}
          <div className="flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase tracking-wide text-foreground/40">{t("orDivider")}</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </div>
      )}

      {step === "phone" && (
        <form onSubmit={handleRequestOtp} className="mt-8 flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label htmlFor="phoneNumber" className="text-sm font-medium text-foreground/80">
              {t("phoneLabel")}
            </label>
            <input
              id="phoneNumber"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              value={phoneNumber}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setPhoneNumber(event.target.value)}
              placeholder={t("phonePlaceholder")}
              className="rounded-xl border border-border bg-background/60 px-4 py-3 text-start text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              dir="ltr"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading || !phoneNumber} className="w-full">
            {loading ? t("loading") : t("requestOtpButton")}
          </Button>
        </form>
      )}

      {step === "otp" && (
        <form onSubmit={handleVerifyOtp} className="mt-8 flex flex-col gap-5">
          {otpSent && (
            <p className="rounded-xl bg-accent px-4 py-2.5 text-sm text-accent-foreground">
              {t("otpSentSuccess")}
            </p>
          )}

          {resendNotice && (
            <p role="status" className="rounded-xl bg-success/10 px-4 py-2.5 text-sm text-success">
              {t("otpResentSuccess")}
            </p>
          )}

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground/80">{t("otpLabel")}</label>
            {/* BUG-1 fix: the OTP boxes must read left-to-right — box index 0 is the
                first digit typed. `dir="ltr"` keeps the code LTR even on an Arabic
                (RTL) page; the previous `flex-row-reverse` visually reversed the
                DOM-ordered boxes on EVERY locale, so a code typed in reading order
                appeared reversed (the submitted value was always correct — it is
                the reading-order join). Plain `flex` + `dir="ltr"` renders index 0
                leftmost in both English and Arabic. */}
            <div className="flex justify-center gap-2" dir="ltr">
              {otpDigits.map((digit: string, index: number) => (
                <input
                  key={index}
                  ref={(el: HTMLInputElement | null) => {
                    otpInputRefs.current[index] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  autoComplete={index === 0 ? "one-time-code" : "off"}
                  maxLength={1}
                  value={digit}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    handleOtpDigitChange(index, event.target.value)
                  }
                  onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => handleOtpKeyDown(index, event)}
                  onPaste={handleOtpPaste}
                  aria-label={`${t("otpLabel")} ${index + 1}`}
                  className="h-12 w-10 rounded-xl border border-border bg-background/60 text-center text-lg font-medium text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              ))}
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading || otp.length < OTP_LENGTH} className="w-full">
            {loading ? t("loading") : t("verifyOtpButton")}
          </Button>

          <div className="flex flex-col items-center gap-2">
            {(() => {
              const resendState = getResendButtonState({
                cooldownSeconds: resendCooldown,
                resending,
                verifying: loading,
              });
              return (
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={resendState.disabled}
                  aria-disabled={resendState.disabled}
                  className="text-sm font-medium text-primary underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-foreground/40 disabled:no-underline"
                >
                  {resendState.label === "loading"
                    ? t("loading")
                    : resendState.label === "cooldown"
                      ? t("resendCooldownLabel", { seconds: resendCooldown })
                      : t("resendOtpButton")}
                </button>
              );
            })()}
            <button
              type="button"
              onClick={handleChangePhoneNumber}
              className="text-sm text-foreground/60 underline-offset-2 hover:underline"
            >
              {t("changePhoneButton")}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
