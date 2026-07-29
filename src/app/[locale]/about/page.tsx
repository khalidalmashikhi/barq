import type { Metadata } from "next";
import { Shield, Sparkles, Gauge, Heart, Compass, MapPin, Users } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { buildLocalizedMetadata } from "@/lib/i18n/metadata";
import { StaticPageLayout } from "@/components/layout/static-page-layout";

// About BARQ — Phase F.4 (Trust, Safety & Marketplace Quality).
//
// Every claim on this page is either (a) the real, already-established
// product positioning already shown elsewhere in this app (the
// Footer's own tagline, the landing page's hero copy — not invented
// for this page), or (b) a description of features that genuinely
// exist and were built in earlier phases (search, booking, real-time
// status tracking, provider tools). No government/regulatory
// partnership is claimed: checked docs/01-business/BUSINESS_MODEL.md
// beforehand — "Ministry of Heritage & Tourism licensing implications"
// is listed there as an acknowledged, UNRESOLVED regulatory risk, not
// a granted partnership or credential — presenting it as a trust
// signal here would misrepresent a flagged risk as an achieved one, so
// it is deliberately omitted entirely.
export async function generateMetadata(): Promise<Metadata> {
  const tCommon = await getServerTranslator("common");
  const tSeo = await getServerTranslator("seo");
  const tPages = await getServerTranslator("pages");
  const locale = await getLocale();

  return buildLocalizedMetadata({
    locale,
    pathname: "/about",
    title: tSeo("pageTitleTemplate", { page: tPages("about.title"), appName: tCommon("appName") }),
    description: tPages("about.subtitle"),
  });
}

export default async function AboutPage() {
  const t = await getServerTranslator("pages");

  const principles = [
    { icon: Shield, labelKey: "trust" },
    { icon: Sparkles, labelKey: "simplicity" },
    { icon: Compass, labelKey: "clarity" },
    { icon: Heart, labelKey: "confidence" },
    { icon: Gauge, labelKey: "speed" },
  ] as const;

  const platformFeatures = [
    { icon: Compass, key: "search" },
    { icon: MapPin, key: "book" },
    { icon: Users, key: "track" },
  ] as const;

  return (
    <StaticPageLayout title={t("about.title")} subtitle={t("about.subtitle")} maxWidthClassName="max-w-4xl">
      {/* Phase 3 Wave 2: restructured from four card grids into an
          editorial narrative — Mission/Vision as full-width prose
          bands (not boxes), the Discover/Book/Track flow visualized
          with a connecting line, and Principles simplified to a plain
          list. No new copy: every string here is unchanged from the
          prior card-based layout, only the container/typography
          changed. */}
      <section className="flex flex-col gap-10 border-s-2 border-primary/20 ps-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">{t("about.missionTitle")}</h2>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-foreground/70">{t("about.missionBody")}</p>
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">{t("about.visionTitle")}</h2>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-foreground/70">{t("about.visionBody")}</p>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold tracking-tight text-foreground">{t("about.platformTitle")}</h2>
        <p className="mb-8 max-w-2xl text-sm leading-relaxed text-foreground/70">{t("about.platformBody")}</p>
        <div className="relative grid grid-cols-1 gap-8 sm:grid-cols-3">
          <div aria-hidden className="absolute inset-x-0 top-5 hidden h-px bg-border sm:block" />
          {platformFeatures.map(({ icon: Icon, key }) => (
            <div key={key} className="relative flex flex-col items-center gap-2 text-center sm:items-start sm:text-start">
              <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Icon size={18} strokeWidth={1.75} />
              </span>
              <h3 className="text-sm font-semibold text-foreground">{t(`about.feature.${key}Title`)}</h3>
              <p className="text-xs leading-relaxed text-foreground/60">{t(`about.feature.${key}Body`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-bold tracking-tight text-foreground">{t("about.whyTitle")}</h2>
        <p className="max-w-2xl text-sm leading-relaxed text-foreground/70">{t("about.whyBody")}</p>
      </section>

      <section>
        <h2 className="mb-5 text-xl font-bold tracking-tight text-foreground">{t("about.principlesTitle")}</h2>
        <div className="flex flex-wrap gap-x-8 gap-y-4">
          {principles.map(({ icon: Icon, labelKey }) => (
            <div key={labelKey} className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-primary">
                <Icon size={16} strokeWidth={1.75} />
              </span>
              <span className="text-sm font-medium text-foreground/70">{t(`about.principle.${labelKey}`)}</span>
            </div>
          ))}
        </div>
      </section>
    </StaticPageLayout>
  );
}
