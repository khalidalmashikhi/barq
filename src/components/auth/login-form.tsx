"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { t } from "@/lib/i18n/strings";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

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

const OTP_LENGTH = 6;

type Step = "phone" | "otp";

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otpDigits, setOtpDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otpSent, setOtpSent] = useState(false);
  const otpInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const otp = otpDigits.join("");

  async function handleRequestOtp(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error: requestError } = await authClient.phoneNumber.sendOtp({
        phoneNumber,
      });

      if (requestError) {
        setError(t.genericError);
        return;
      }

      setOtpSent(true);
      setStep("otp");
    } catch {
      setError(t.genericError);
    } finally {
      setLoading(false);
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
        setError(t.genericError);
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError(t.genericError);
    } finally {
      setLoading(false);
    }
  }

  function handleChangePhoneNumber() {
    setStep("phone");
    setOtpDigits(Array(OTP_LENGTH).fill(""));
    setOtpSent(false);
    setError(null);
  }

  function handleOtpDigitChange(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...otpDigits];
    next[index] = digit;
    setOtpDigits(next);

    if (digit && index < OTP_LENGTH - 1) {
      otpInputRefs.current[index + 1]?.focus();
    }
  }

  function handleOtpKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  }

  function handleOtpPaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (!pasted) return;
    event.preventDefault();
    const next = Array(OTP_LENGTH).fill("");
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setOtpDigits(next);
    otpInputRefs.current[Math.min(pasted.length, OTP_LENGTH - 1)]?.focus();
  }

  return (
    <Card
      className="w-full max-w-md border-white/60 bg-glass shadow-premium-lg animate-fade-up"
      hoverLift={false}
    >
      <h1 className="text-2xl font-semibold text-foreground">{t.loginTitle}</h1>
      <p className="mt-1.5 text-sm text-foreground/60">{t.loginSubtitle}</p>

      {step === "phone" && (
        <form onSubmit={handleRequestOtp} className="mt-8 flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label htmlFor="phoneNumber" className="text-sm font-medium text-foreground/80">
              {t.phoneLabel}
            </label>
            <input
              id="phoneNumber"
              type="tel"
              inputMode="tel"
              required
              value={phoneNumber}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setPhoneNumber(event.target.value)}
              placeholder={t.phonePlaceholder}
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
            {loading ? t.loading : t.requestOtpButton}
          </Button>
        </form>
      )}

      {step === "otp" && (
        <form onSubmit={handleVerifyOtp} className="mt-8 flex flex-col gap-5">
          {otpSent && (
            <p className="rounded-xl bg-accent px-4 py-2.5 text-sm text-accent-foreground">
              {t.otpSentSuccess}
            </p>
          )}

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground/80">{t.otpLabel}</label>
            <div className="flex flex-row-reverse justify-center gap-2" dir="ltr">
              {otpDigits.map((digit: string, index: number) => (
                <input
                  key={index}
                  ref={(el: HTMLInputElement | null) => {
                    otpInputRefs.current[index] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    handleOtpDigitChange(index, event.target.value)
                  }
                  onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => handleOtpKeyDown(index, event)}
                  onPaste={handleOtpPaste}
                  aria-label={`${t.otpLabel} ${index + 1}`}
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
            {loading ? t.loading : t.verifyOtpButton}
          </Button>

          <button
            type="button"
            onClick={handleChangePhoneNumber}
            className="text-sm text-foreground/60 underline-offset-2 hover:underline"
          >
            {t.changePhoneButton}
          </button>
        </form>
      )}
    </Card>
  );
}
