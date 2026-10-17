import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { buildLocalizedMetadata } from "@/lib/i18n/metadata";
import { REGION_CODES, regionLabelKey } from "@/lib/regions";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { TripPlanner } from "./_components/trip-planner";

// 2026-10-17 — Trip planner, grounded foundation: the public customer page ("خطط رحلتك").
// No sign-in needed and nothing stored. The page passes only the localized region list; the
// client island asks `/api/v1/trips/plan` for a plan grounded in published BARQ services.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerTranslator("trips");
  const locale = await getLocale();
  return buildLocalizedMetadata({ locale, pathname: "/trips", title: t("pageTitle"), description: t("pageSubtitle") });
}

export default async function TripsPage() {
  const t = await getServerTranslator("trips");
  const tc = await getServerTranslator("common");
  const regions = REGION_CODES.map((code) => ({ code, label: tc(regionLabelKey(code) as Parameters<typeof tc>[0]) }));
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main id="main-content" className="mx-auto flex w-full max-w-[52rem] flex-1 flex-col gap-6 px-4 pb-10 pt-6 sm:px-6 sm:pt-10">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold text-primary">{t("pageTitle")}</h1>
          <p className="text-base text-foreground/80">{t("pageSubtitle")}</p>
        </header>
        <TripPlanner regions={regions} />
      </main>
      <Footer />
    </div>
  );
}
