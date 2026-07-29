import type { Metadata } from "next";
import { Mail, LifeBuoy } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { buildLocalizedMetadata } from "@/lib/i18n/metadata";
import { StaticPageLayout } from "@/components/layout/static-page-layout";

// Contact page — Phase F.4 (goal 5, Contact Experience). No backend
// contact-form/ticketing system, support email, or working-hours
// config exists anywhere in this app (confirmed by grep across the
// whole repo, including .env.example, before writing this page) — so
// this deliberately does NOT invent a support email or phone number.
// It states the real current state honestly (same "Coming soon"
// discipline as ProviderProfileCard's disabled Contact Provider
// button) and routes users to the one real self-service resource that
// does exist: the Help Center built earlier this phase.
export async function generateMetadata(): Promise<Metadata> {
  const tCommon = await getServerTranslator("common");
  const tSeo = await getServerTranslator("seo");
  const tPages = await getServerTranslator("pages");
  const locale = await getLocale();

  return buildLocalizedMetadata({
    locale,
    pathname: "/contact",
    title: tSeo("pageTitleTemplate", { page: tPages("contact.title"), appName: tCommon("appName") }),
    description: tPages("contact.subtitle"),
  });
}

export default async function ContactPage() {
  const t = await getServerTranslator("pages");

  return (
    <StaticPageLayout title={t("contact.title")} subtitle={t("contact.subtitle")} maxWidthClassName="max-w-2xl">
      {/* Phase 3 Wave 2: collapsed from 3 equal-weight boxed cards into
          one coherent panel — a single headline statement (the real
          "no direct channel yet" disclosure, unchanged in substance)
          followed by supporting detail as a plain icon+text list, so
          it reads as one clear answer rather than three separate
          disclaimers. No new copy: same three real facts as before. */}
      <div className="rounded-2xl border border-border bg-card p-7">
        <h2 className="text-lg font-semibold text-foreground">{t("contact.noticeTitle")}</h2>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-foreground/60">{t("contact.noticeBody")}</p>

        <div className="mt-6 flex flex-col gap-5 border-t border-border pt-6">
          <Link
            href="/help"
            className="group flex items-start gap-3 rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-primary">
              <LifeBuoy size={16} strokeWidth={1.75} />
            </span>
            <div>
              <h3 className="text-sm font-medium text-foreground group-hover:text-primary">{t("contact.helpCenterTitle")}</h3>
              <p className="mt-0.5 text-sm leading-relaxed text-foreground/60">{t("contact.helpCenterBody")}</p>
            </div>
          </Link>

          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-primary">
              <Mail size={16} strokeWidth={1.75} />
            </span>
            <div>
              <h3 className="text-sm font-medium text-foreground">{t("contact.bookingIssuesTitle")}</h3>
              <p className="mt-0.5 text-sm leading-relaxed text-foreground/60">{t("contact.bookingIssuesBody")}</p>
            </div>
          </div>
        </div>
      </div>
    </StaticPageLayout>
  );
}
