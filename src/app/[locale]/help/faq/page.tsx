import type { Metadata } from "next";
import { Search } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { buildLocalizedMetadata } from "@/lib/i18n/metadata";
import { StaticPageLayout } from "@/components/layout/static-page-layout";
import { FaqAccordion, type FaqItem } from "@/components/ui/faq-accordion";
import { EmptyState } from "@/components/ui/empty-state";

// General FAQ — Phase F.4 (Help Center). Reuses the same FaqAccordion
// built for the landing page's FAQ section (see faq-accordion.tsx) —
// a different, platform-wide question set from the landing page's
// marketing-focused 4 questions.
export async function generateMetadata(): Promise<Metadata> {
  const tCommon = await getServerTranslator("common");
  const tSeo = await getServerTranslator("seo");
  const tPages = await getServerTranslator("pages");
  const locale = await getLocale();

  return buildLocalizedMetadata({
    locale,
    pathname: "/help/faq",
    title: tSeo("pageTitleTemplate", { page: tPages("faq.title"), appName: tCommon("appName") }),
    description: tPages("faq.subtitle"),
  });
}

type Props = { searchParams: Promise<{ q?: string }> };

export default async function FaqPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const t = await getServerTranslator("pages");

  const allItems: FaqItem[] = (["account", "booking", "cancellation", "payment", "provider"] as const).map((key) => ({
    question: t(`faq.${key}Question`),
    answer: t(`faq.${key}Answer`),
  }));

  // Real, server-side substring filter against the actual question/answer
  // text above — not a client-side stub and not a fake "no results ever"
  // dead end. Works because the FAQ set is small and fully known at
  // request time; no search index or client JS required.
  const query = q?.trim().toLowerCase();
  const items = query
    ? allItems.filter((item) => item.question.toLowerCase().includes(query) || item.answer.toLowerCase().includes(query))
    : allItems;

  return (
    <StaticPageLayout title={t("faq.title")} subtitle={t("faq.subtitle")}>
      <form action="/help/faq" method="GET" className="mb-6 flex items-center gap-2 rounded-full border border-border bg-card p-2 shadow-premium">
        <Search size={18} strokeWidth={1.75} className="ms-3 shrink-0 text-foreground/40" aria-hidden />
        <input
          type="search"
          name="q"
          defaultValue={q}
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

      {items.length > 0 ? (
        <FaqAccordion items={items} />
      ) : (
        <EmptyState icon={Search} message={t("faq.noResultsLabel")} padding="py-16" />
      )}
    </StaticPageLayout>
  );
}
