import type { Metadata } from "next";
import { PackagePlus, Calendar, ListChecks, BarChart3 } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { buildLocalizedMetadata } from "@/lib/i18n/metadata";
import { StaticPageLayout } from "@/components/layout/static-page-layout";

// Provider Help — Phase F.4 (Help Center). Describes the real provider
// tools already shipped in Phase F.3 (services CRUD, availability
// management, booking management, dashboard metrics) — no invented
// provider capability.
export async function generateMetadata(): Promise<Metadata> {
  const tCommon = await getServerTranslator("common");
  const tSeo = await getServerTranslator("seo");
  const tPages = await getServerTranslator("pages");
  const locale = await getLocale();

  return buildLocalizedMetadata({
    locale,
    pathname: "/help/provider",
    title: tSeo("pageTitleTemplate", { page: tPages("providerHelp.title"), appName: tCommon("appName") }),
    description: tPages("providerHelp.subtitle"),
  });
}

export default async function ProviderHelpPage() {
  const t = await getServerTranslator("pages");

  const topics = [
    { icon: PackagePlus, key: "services" },
    { icon: Calendar, key: "availability" },
    { icon: ListChecks, key: "bookings" },
    { icon: BarChart3, key: "dashboard" },
  ] as const;

  return (
    <StaticPageLayout title={t("providerHelp.title")} subtitle={t("providerHelp.subtitle")}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {topics.map(({ icon: Icon, key }) => (
          <div key={key} className="rounded-2xl border border-border bg-card p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/15 text-primary">
              <Icon size={18} strokeWidth={1.75} />
            </span>
            <h2 className="mt-3 text-sm font-medium text-foreground">{t(`providerHelp.topic.${key}Title`)}</h2>
            <p className="mt-1 text-sm leading-relaxed text-foreground/60">{t(`providerHelp.topic.${key}Body`)}</p>
          </div>
        ))}
      </div>
    </StaticPageLayout>
  );
}
