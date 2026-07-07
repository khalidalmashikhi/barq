"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { t } from "@/lib/i18n/strings";

// Login form — Engineering Sprint 3 (Phone OTP UI).
//
// Two steps: phone entry -> OTP entry. Minimal local state, no external
// state library, consistent with "do not overdesign."
//
// KNOWN BLOCKER (see DEVELOPMENT_LOG.md and this sprint's report): the
// sendOtp/verify calls below target Better Auth's phoneNumber plugin,
// which is not yet enabled server-side pending a schema decision. These
// calls will fail at runtime until that is resolved and approved — this
// component is written to be correct once it is, not to demonstrate a
// working end-to-end flow today.

type Step = "phone" | "otp";

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otpSent, setOtpSent] = useState(false);

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
    setOtp("");
    setOtpSent(false);
    setError(null);
  }

  return (
    <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-neutral-900">{t.loginTitle}</h1>
      <p className="mt-1 text-sm text-neutral-500">{t.loginSubtitle}</p>

      {step === "phone" && (
        <form onSubmit={handleRequestOtp} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="phoneNumber" className="text-sm font-medium text-neutral-700">
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
              className="rounded-md border border-neutral-300 px-3 py-2 text-start text-neutral-900 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500"
              dir="ltr"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading || !phoneNumber}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
          >
            {loading ? t.loading : t.requestOtpButton}
          </button>
        </form>
      )}

      {step === "otp" && (
        <form onSubmit={handleVerifyOtp} className="mt-6 flex flex-col gap-4">
          {otpSent && (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {t.otpSentSuccess}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="otp" className="text-sm font-medium text-neutral-700">
              {t.otpLabel}
            </label>
            <input
              id="otp"
              type="text"
              inputMode="numeric"
              required
              value={otp}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setOtp(event.target.value)}
              placeholder={t.otpPlaceholder}
              className="rounded-md border border-neutral-300 px-3 py-2 text-start text-neutral-900 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500"
              dir="ltr"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading || !otp}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
          >
            {loading ? t.loading : t.verifyOtpButton}
          </button>

          <button
            type="button"
            onClick={handleChangePhoneNumber}
            className="text-sm text-neutral-500 underline-offset-2 hover:underline"
          >
            {t.changePhoneButton}
          </button>
        </form>
      )}
    </div>
  );
}
