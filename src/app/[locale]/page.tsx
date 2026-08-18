import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getSession } from "@/lib/auth";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { buildLocalizedMetadata } from "@/lib/i18n/metadata";
import { isValidRegionCode } from "@/lib/regions";
import { getHomeDiscovery } from "@/lib/discovery/get-home-discovery";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { HomeHero } from "@/components/home/home-hero";
import { DiscoveryGrid } from "@/components/home/discovery-grid";
import { SelectedForYou } from "@/components/home/selected-for-you";
import { ExploreOman } from "@/components/home/explore-oman";

// Public customer Home (HOME-1) — the minimal, premium tourism-marketplace
// landing built on the approved Home Discovery read model (getHomeDiscovery).
//
// Intentionally FIVE layers only — Hero/Search/Governorate, "What are you
// looking for?" (the six discovery groups), "Selected for you" (the read model's
// deterministic recommended list), Explore Oman, and the shared Footer. The prior
// dense marketing page (12+ registry-driven sections) is deliberately retired for
// this surface; the Homepage Section Registry backend is untouched and still
// serves admin/experiments elsewhere.
//
// Server-first: this file and every section are Server Components. The ONE read
// (getHomeDiscovery) is bounded (6 groups × ≤6 previews + ≤6 recommended) and
// governorate-scoped server-side — no client fetch, no N+1, no client filtering.
//
// Authenticated visitors are still redirected to /dashboard, exactly as before.

export async function generateMetadata(): Promise<Metadata> {
  const tCommon = await getServerTranslator("common");
  const tSeo = await getServerTranslator("seo");
  const locale = await getLocale();

  return buildLocalizedMetadata({
    locale,
    pathname: "",
    title: tCommon("appName"),
    description: tSeo("defaultDescription"),
  });
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ region?: string }> }) {
  const session = await getSession();

  if (session) {
    const locale = await getLocale();
    redirect({ href: "/dashboard", locale });
  }

  const locale = await getLocale();
  const params = await searchParams;

  // Only a valid governed code narrows the Home; anything else is treated as
  // "All Oman" (the read model itself also fails safe on an unknown region).
  const regionCode = params.region && isValidRegionCode(params.region) ? params.region : null;
  const discovery = await getHomeDiscovery({ regionCode, locale });

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main id="main-content" className="flex-1">
        <HomeHero governorates={discovery.governorates} selectedGovernorate={discovery.selectedGovernorate} />
        <DiscoveryGrid region={discovery.selectedGovernorate} />
        <SelectedForYou items={discovery.recommended} />
        <ExploreOman destinations={discovery.destinations} />
      </main>
      <Footer />
    </div>
  );
}
