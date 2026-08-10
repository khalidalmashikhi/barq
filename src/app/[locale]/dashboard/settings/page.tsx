import type { Metadata } from "next";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { UnauthenticatedError } from "@/lib/auth";
import { getCustomerSettings } from "@/lib/customer/get-customer-settings";
import { updateCustomerSettings } from "@/lib/customer/update-customer-settings";
import { getUnreadCount } from "@/lib/notifications/get-unread-count";
import { getCustomerNavItems } from "@/lib/dashboard/customer-nav-items";
import { resolveCustomerNavOptions } from "@/lib/dashboard/resolve-customer-nav-options";
import { AppShell } from "@/components/app-shell/app-shell";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { locales } from "@/i18n/locales";

// Customer Account Settings (Finish-Line: Customer Profile). The real
// edit-after-registration surface — display name + preferred language — closing
// the loop the previously-inert "Settings" nav item left open. Phone is shown
// read-only (immutable auth identity). Mirrors the provider settings page shape.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Native endonyms — locale-independent, so they need no translation.
const LOCALE_ENDONYMS: Record<string, string> = {
  ar: "العربية",
  en: "English",
  de: "Deutsch",
  it: "Italiano",
  pl: "Polski",
  fr: "Français",
  cs: "Čeština",
  ru: "Русский",
};

type SearchParams = { notice?: string; error?: string };

export default async function CustomerSettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { notice, error } = await searchParams;
  const locale = await getLocale();

  let settings;
  try {
    settings = await getCustomerSettings();
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    throw err;
  }

  const t = await getServerTranslator("dashboard");
  const [unreadNotificationsCount, navOptions] = await Promise.all([getUnreadCount(), resolveCustomerNavOptions()]);

  return (
    <AppShell
      navItems={getCustomerNavItems(t, locale, unreadNotificationsCount, navOptions)}
      roleLabel={t("roleLabel")}
      unreadNotificationsCount={unreadNotificationsCount}
    >
      <div className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-10">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("settingsTitle")}</h1>
          <p className="mt-1 text-sm text-foreground/60">{t("settingsSubtitle")}</p>
        </div>

        {notice === "saved" && <Alert variant="success">{t("settingsSavedNotice")}</Alert>}
        {error && <Alert variant="danger">{t("settingsErrorNotice")}</Alert>}

        <form
          action={async (formData: FormData) => {
            "use server";
            const result = await updateCustomerSettings(formData);
            redirect({ href: result.ok ? "/dashboard/settings?notice=saved" : "/dashboard/settings?error=1", locale });
          }}
          className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-sm"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground/50">{t("settingsNameLabel")}</span>
            <input
              type="text"
              name="name"
              maxLength={120}
              defaultValue={settings.name}
              placeholder={t("settingsNamePlaceholder")}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <span className="text-xs text-foreground/40">{t("settingsNameHint")}</span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground/50">{t("settingsPhoneLabel")}</span>
            <input
              type="tel"
              dir="ltr"
              value={settings.phoneNumber ?? ""}
              readOnly
              disabled
              className="rounded-xl border border-border bg-background/50 px-3 py-2 text-sm text-foreground/60"
            />
            <span className="text-xs text-foreground/40">{t("settingsPhoneHint")}</span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground/50">{t("settingsLanguageLabel")}</span>
            <select
              name="languagePreference"
              defaultValue={settings.languagePreference}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">{t("settingsLanguageAuto")}</option>
              {locales.map((code) => (
                <option key={code} value={code}>
                  {LOCALE_ENDONYMS[code] ?? code}
                </option>
              ))}
            </select>
          </label>

          <SubmitButton className="mt-1 self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
            {t("settingsSaveButton")}
          </SubmitButton>
        </form>
      </div>
    </AppShell>
  );
}
