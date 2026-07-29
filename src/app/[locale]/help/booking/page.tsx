import type { Metadata } from "next";
import { Search, CalendarCheck, Bell, XCircle } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { buildLocalizedMetadata } from "@/lib/i18n/metadata";
import { StaticPageLayout } from "@/components/layout/static-page-layout";

// Booking Help — Phase F.4 (Help Center). Describes the real, existing
// booking journey (search → request → confirmation notification →
// cancellation while Pending/Confirmed) — mirrors the exact same
// steps already shown in the booking timeline and confirmation page's
// "What happens next" copy, not a separate invented flow.
export async function generateMetadata(): Promise<Metadata> {
  const tCommon = await getServerTranslator("common");
  const tSeo = await getServerTranslator("seo");
  const tPages = await getServerTranslator("pages");
  const locale = await getLocale();

  return buildLocalizedMetadata({
    locale,
    pathname: "/help/booking",
    title: tSeo("pageTitleTemplate", { page: tPages("bookingHelp.title"), appName: tCommon("appName") }),
    description: tPages("bookingHelp.subtitle"),
  });
}

export default async function BookingHelpPage() {
  const t = await getServerTranslator("pages");

  const steps = [
    { icon: Search, key: "search" },
    { icon: CalendarCheck, key: "request" },
    { icon: Bell, key: "confirm" },
    { icon: XCircle, key: "cancel" },
  ] as const;

  return (
    <StaticPageLayout title={t("bookingHelp.title")} subtitle={t("bookingHelp.subtitle")}>
      <div className="flex flex-col gap-4">
        {steps.map(({ icon: Icon, key }, index) => (
          <div key={key} className="flex gap-4 rounded-2xl border border-border bg-card p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-primary">
              <Icon size={18} strokeWidth={1.75} />
            </span>
            <div>
              <h2 className="text-sm font-medium text-foreground">
                {index + 1}. {t(`bookingHelp.step.${key}Title`)}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-foreground/60">{t(`bookingHelp.step.${key}Body`)}</p>
            </div>
          </div>
        ))}
      </div>
    </StaticPageLayout>
  );
}
