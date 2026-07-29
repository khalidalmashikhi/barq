import type { Metadata } from "next";
import { HelpCircle, CalendarCheck, Briefcase, MessageCircle, Search } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { buildLocalizedMetadata } from "@/lib/i18n/metadata";
import { StaticPageLayout } from "@/components/layout/static-page-layout";

// Help Center hub — Phase F.4. Real navigation to the 4 sub-pages this
// phase builds (FAQ, Booking Help, Provider Help, Contact) — no
// invented support-ticket system, no live-chat widget.
export async function generateMetadata(): Promise<Metadata> {
  const tCommon = await getServerTranslator("common");
  const tSeo = await getServerTranslator("seo");
  const tPages = await getServerTranslator("pages");
  const locale = await getLocale();

  return buildLocalizedMetadata({
    locale,
    pathname: "/help",
    title: tSeo("pageTitleTemplate", { page: tPages("help.title"), appName: tCommon("appName") }),
    description: tPages("help.subtitle"),
  });
}

export default async function HelpCenterPage() {
  const t = await getServerTranslator("pages");

  const secondaryCards = [
    { href: "/help/booking", icon: CalendarCheck, titleKey: "bookingCardTitle", descKey: "bookingCardDescription" },
    { href: "/help/provider", icon: Briefcase, titleKey: "providerCardTitle", descKey: "providerCardDescription" },
    { href: "/contact", icon: MessageCircle, titleKey: "contactCardTitle", descKey: "contactCardDescription" },
  ] as const;

  return (
    <StaticPageLayout title={t("help.title")} subtitle={t("help.subtitle")} maxWidthClassName="max-w-4xl">
      {/* Real GET form to /help/faq's own `q` param (faq/page.tsx filters
          server-side by substring match) — a genuinely functional
          search, not a decorative box that goes nowhere. */}
      <form action="/help/faq" method="GET" className="flex items-center gap-2 rounded-full border border-border bg-card p-2 shadow-premium">
        <Search size={18} strokeWidth={1.75} className="ms-3 shrink-0 text-foreground/40" aria-hidden />
        <input
          type="search"
          name="q"
          placeholder={t("help.searchPlaceholder")}
          aria-label={t("help.searchPlaceholder")}
          className="min-w-0 flex-1 bg-transparent px-1 py-2.5 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
        />
        <button
          type="submit"
          className="shrink-0 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {t("help.searchButton")}
        </button>
      </form>

      <Link
        href="/help/faq"
        className="mt-6 flex flex-col gap-3 rounded-2xl border border-border bg-card p-7 shadow-sm transition-shadow hover:shadow-premium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:flex-row sm:items-center sm:gap-5"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <HelpCircle size={22} strokeWidth={1.75} />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t("help.faqCardTitle")}</h2>
          <p className="mt-1 text-sm leading-relaxed text-foreground/60">{t("help.faqCardDescription")}</p>
        </div>
      </Link>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {secondaryCards.map(({ href, icon: Icon, titleKey, descKey }) => (
          <Link
            key={href}
            href={href}
            className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-premium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/15 text-primary">
              <Icon size={16} strokeWidth={1.75} />
            </span>
            <h2 className="text-sm font-semibold text-foreground">{t(`help.${titleKey}`)}</h2>
            <p className="text-xs leading-relaxed text-foreground/60">{t(`help.${descKey}`)}</p>
          </Link>
        ))}
      </div>
    </StaticPageLayout>
  );
}
