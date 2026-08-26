import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireAuth, UnauthenticatedError, isActiveAdminSession } from "@/lib/auth";
import { getCustomerCredentialState } from "@/lib/auth/customer-credential-state";
import { isEmailOtpConfigured } from "@/lib/email-otp/get-email-provider";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { AddPhoneButton } from "@/components/auth/add-phone-button";
import { AddEmailButton } from "@/components/auth/add-email-button";
import { Logo } from "@/components/ui/logo";

// AUTH-DUAL-VERIFICATION-1 — the mandatory Customer credential-completion screen.
// A BARQ customer must have BOTH a verified phone AND a verified real email before
// using the customer app; this page collects whichever is still missing and attaches
// it to the SAME AuthUser (via AddPhoneButton / AddEmailButton). It lives OUTSIDE
// /dashboard so the dashboard completion guard never loops here.
//
// Auth is enforced here (an unauthenticated visitor -> /login). Active admins are
// never funnelled through customer onboarding (-> /admin). A COMPLETE customer who
// lands here is sent straight to /dashboard. Exactly one credential is normally
// missing (signup verifies one); if both are somehow missing, phone is collected
// first and the page re-renders for email after.

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function OnboardingPage() {
  const locale = await getLocale();

  try {
    await requireAuth();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    throw error;
  }

  if (await isActiveAdminSession()) {
    redirect({ href: "/admin", locale });
    return null;
  }

  const state = await getCustomerCredentialState();
  if (state.isComplete) {
    redirect({ href: "/dashboard", locale });
    return null;
  }

  const t = await getServerTranslator("auth");
  const needsPhone = !state.hasVerifiedPhone;
  const needsEmail = !state.hasVerifiedEmail;
  const emailAvailable = isEmailOtpConfigured();

  return (
    <main className="flex min-h-screen items-center justify-center bg-luxury-gradient px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-white/60 bg-glass p-8 shadow-premium-lg">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo />
          <h1 className="text-xl font-semibold text-foreground">{t("onboardingHeading")}</h1>
          <p className="text-sm text-foreground/60">{t("onboardingSubtitle")}</p>
        </div>

        {needsPhone ? (
          <div className="flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">{t("onboardingPhoneTitle")}</h2>
              <p className="mt-0.5 text-xs text-foreground/50">{t("onboardingPhoneSubtitle")}</p>
            </div>
            <AddPhoneButton />
          </div>
        ) : needsEmail ? (
          emailAvailable ? (
            <div className="flex flex-col gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">{t("onboardingEmailTitle")}</h2>
                <p className="mt-0.5 text-xs text-foreground/50">{t("onboardingEmailSubtitle")}</p>
              </div>
              <AddEmailButton />
            </div>
          ) : (
            <p role="alert" className="text-sm text-danger">
              {t("onboardingUnavailable")}
            </p>
          )
        ) : null}
      </div>
    </main>
  );
}
