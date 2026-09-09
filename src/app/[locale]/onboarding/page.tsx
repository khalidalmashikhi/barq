import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import {
  requireAuth,
  UnauthenticatedError,
  isActiveAdminSession,
  resolveEffectiveAccountType,
  routeForEffectiveAccountType,
} from "@/lib/auth";
import { getRegistrationStepForUser } from "@/lib/registration/registration-state";
import { isEmailOtpConfigured } from "@/lib/email-otp/get-email-provider";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { AddPhoneButton } from "@/components/auth/add-phone-button";
import { AddEmailButton } from "@/components/auth/add-email-button";
import { LogoutButton } from "@/components/auth/logout-button";
import { AccountTypeChooser } from "@/components/auth/registration/account-type-chooser";
import { RegistrationNameForm } from "@/components/auth/registration/registration-name-form";
import { FinalizeRegistrationButton } from "@/components/auth/registration/finalize-registration-button";
import { Logo } from "@/components/ui/logo";

// EXCLUSIVE PHONE-FIRST REGISTRATION — Gate Z-2. The single registration-continuation
// hub. Its content is driven entirely by the server-authoritative registration step
// (resolveRegistrationStep), so refresh / browser-reopen / multi-device all resume at the
// right step. An active admin is never funnelled here (Gate A). A finalized/legacy
// identity (step DONE) is routed to its role landing by the Z-1 effective-type map.

export const metadata: Metadata = { robots: { index: false, follow: false } };

// The registration error keys the client islands may need to render (auth namespace).
const REGISTRATION_ERROR_KEYS = [
  "registrationErrorInvalidType",
  "registrationErrorInvalidName",
  "registrationErrorAlreadyClassified",
  "registrationErrorNoDeclaredType",
  "registrationErrorNameRequired",
  "registrationErrorPhoneNotVerified",
  "registrationErrorEmailNotVerified",
  "registrationErrorProfileConflict",
  "registrationErrorUnknown",
] as const;

export default async function OnboardingPage() {
  const locale = await getLocale();

  let barqUser;
  try {
    const auth = await requireAuth();
    barqUser = auth.barqUser;
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

  const step = await getRegistrationStepForUser(barqUser);
  if (step === "DONE") {
    const effectiveType = await resolveEffectiveAccountType(barqUser.id);
    redirect({ href: routeForEffectiveAccountType(effectiveType), locale });
    return null;
  }

  const t = await getServerTranslator("auth");
  const emailAvailable = isEmailOtpConfigured();
  const errorLabels = Object.fromEntries(REGISTRATION_ERROR_KEYS.map((k) => [k, t(k)]));

  return (
    <main className="flex min-h-screen items-center justify-center bg-luxury-gradient px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-white/60 bg-glass p-8 shadow-premium-lg">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo />
          <h1 className="text-xl font-semibold text-foreground">
            {step === "CHOOSE_USAGE" ? t("registrationChooseUsageHeading") : t("onboardingHeading")}
          </h1>
          <p className="text-sm text-foreground/60">
            {step === "CHOOSE_USAGE" ? t("registrationChooseUsageSubtitle") : t("onboardingSubtitle")}
          </p>
        </div>

        {step === "CHOOSE_USAGE" && (
          <AccountTypeChooser
            errorLabels={errorLabels}
            labels={{
              customerTitle: t("registrationCustomerTitle"),
              customerDescription: t("registrationCustomerDescription"),
              providerTitle: t("registrationProviderTitle"),
              providerDescription: t("registrationProviderDescription"),
              genericError: t("registrationErrorUnknown"),
            }}
          />
        )}

        {step === "COMPLETE_DETAILS" && (
          <div className="flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">{t("registrationNameHeading")}</h2>
            </div>
            {!barqUser.name || barqUser.name.trim() === "" ? (
              <RegistrationNameForm
                errorLabels={errorLabels}
                defaultValue={barqUser.name ?? ""}
                labels={{
                  label: t("registrationNameLabel"),
                  placeholder: t("registrationNamePlaceholder"),
                  submit: t("registrationNameSubmit"),
                  genericError: t("registrationErrorUnknown"),
                }}
              />
            ) : (
              // Name is set but the phone is not verified yet (social-first entry).
              <div className="flex flex-col gap-3">
                <p className="text-sm text-foreground/60">{t("onboardingPhoneSubtitle")}</p>
                <AddPhoneButton />
              </div>
            )}
          </div>
        )}

        {step === "VERIFY_EMAIL" && (
          <div className="flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">{t("onboardingEmailTitle")}</h2>
              <p className="mt-0.5 text-xs text-foreground/70">{t("onboardingEmailSubtitle")}</p>
            </div>
            {emailAvailable ? (
              <AddEmailButton />
            ) : (
              <p role="alert" className="text-sm text-danger">
                {t("onboardingUnavailable")}
              </p>
            )}
          </div>
        )}

        {step === "FINALIZE" && (
          <div className="flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">{t("registrationFinalizeHeading")}</h2>
              <p className="mt-0.5 text-xs text-foreground/70">{t("registrationFinalizeSubtitle")}</p>
            </div>
            <FinalizeRegistrationButton
              errorLabels={errorLabels}
              labels={{ finish: t("registrationFinishButton"), genericError: t("registrationErrorUnknown") }}
            />
          </div>
        )}

        {/* GLOBAL SIGN-OUT UX — an escape hatch on this authenticated, shell-less screen
            (wrong account, or an email-OTP dead-end): reuse the one canonical LogoutButton. */}
        <div className="mt-6 border-t border-border/40 pt-4 text-center">
          <LogoutButton />
        </div>
      </div>
    </main>
  );
}
