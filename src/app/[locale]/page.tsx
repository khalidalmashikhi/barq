import type { Metadata } from "next";
import { Fragment } from "react";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getSession } from "@/lib/auth";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { buildLocalizedMetadata } from "@/lib/i18n/metadata";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { DEFAULT_HOMEPAGE_SECTION_KEYS, HOMEPAGE_SECTION_REGISTRY } from "@/components/landing/homepage-section-registry";
import { getHomepageSectionRenderOrder } from "@/lib/homepage/get-homepage-section-render-order";

// Public marketing landing page — Phase F.1 (UI/UX Redesign
// Foundation).
//
// REPLACES the prior combined hero+login page: "/" previously WAS the
// login form for every unauthenticated visitor — no way to browse or
// feel "inspired to explore destinations before performing any
// action" (this phase's own Product Vision). The login experience
// itself was relocated, unchanged in substance, to
// src/app/[locale]/login/page.tsx; this file is now a genuine public
// marketing page: Hero+Search, Featured Experiences, Categories,
// Popular Destinations, Trusted Providers, How BARQ Works, Why Choose
// BARQ, Statistics, Testimonials (placeholder), FAQ, CTA, and the
// Navbar/Footer pair (built in an earlier, unfinished pass — Visual
// Identity Sprint — and never rendered by any page until now).
//
// Authenticated visitors are still redirected straight to /dashboard,
// exactly as before — this page is for people who are NOT signed in,
// or who arrive here deliberately from a link.
//
// Phase 1.5 (Homepage Rendering): the section list itself is no longer
// hardcoded JSX — it's resolved via getHomepageSectionRenderOrder()
// against the Homepage Sections backend (Phase 1.4), then rendered from
// HOMEPAGE_SECTION_REGISTRY. Behavior is unchanged by default: with the
// `homepage_dynamic_sections` feature flag off (or no sections
// configured yet), this renders the exact same components, in the exact
// same order, as the hardcoded version did.

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

export default async function HomePage() {
  const session = await getSession();

  if (session) {
    const locale = await getLocale();
    redirect({ href: "/dashboard", locale });
  }

  const sectionKeys = await getHomepageSectionRenderOrder(DEFAULT_HOMEPAGE_SECTION_KEYS);

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main id="main-content" className="flex-1">
        {sectionKeys.map((key) => {
          const renderSection = HOMEPAGE_SECTION_REGISTRY[key];
          return renderSection ? <Fragment key={key}>{renderSection()}</Fragment> : null;
        })}
      </main>
      <Footer />
    </div>
  );
}
