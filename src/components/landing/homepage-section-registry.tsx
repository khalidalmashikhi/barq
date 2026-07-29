import type { ReactElement } from "react";
import { HeroSection } from "./hero-section";
import { TrustBar } from "./trust-bar";
import { CredibilityStrip } from "./credibility-strip";
import { SectionBand } from "./section-band";
import { FeaturedExperiencesSection } from "./featured-experiences-section";
import { CategoriesSection } from "./categories-section";
import { DestinationsSection } from "./destinations-section";
import { ProvidersSection } from "./providers-section";
import { HowItWorksSection } from "./how-it-works-section";
import { WhyChooseSection } from "./why-choose-section";
import { StatsSection } from "./stats-section";
import { TestimonialsSection } from "./testimonials-section";
import { FaqSection } from "./faq-section";
import { CtaSection } from "./cta-section";
import { FadeIn } from "@/components/ui/fade-in";

// Homepage Section registry — Phase 1.5 (Homepage Rendering). Maps each
// HomepageSection.key an admin can create in the Homepage Sections admin
// UI (Phase 1.4) to the exact existing landing-page markup for that
// section — tone/FadeIn wrapper included exactly as page.tsx rendered
// it before this phase, so wiring in a data-driven order changes
// nothing visually by itself. Reuses every component unchanged; adds no
// new ones.
//
// This array's order is also the default, static rendering order used
// whenever no admin has opted into database-driven ordering (see
// get-homepage-section-render-order.ts) — today's homepage, unchanged.

export const DEFAULT_HOMEPAGE_SECTION_KEYS = [
  "hero",
  "trust_bar",
  "credibility_strip",
  "featured_experiences",
  "categories",
  "destinations",
  "providers",
  "how_it_works",
  "why_choose",
  "stats",
  "testimonials",
  "faq",
  "cta",
] as const;

export const HOMEPAGE_SECTION_REGISTRY: Record<string, () => ReactElement> = {
  hero: () => <HeroSection />,
  trust_bar: () => (
    <FadeIn>
      <TrustBar />
    </FadeIn>
  ),
  credibility_strip: () => (
    <FadeIn>
      <CredibilityStrip />
    </FadeIn>
  ),
  featured_experiences: () => (
    <SectionBand tone="white">
      <FadeIn>
        <FeaturedExperiencesSection />
      </FadeIn>
    </SectionBand>
  ),
  categories: () => (
    <SectionBand tone="sand">
      <FadeIn>
        <CategoriesSection />
      </FadeIn>
    </SectionBand>
  ),
  destinations: () => (
    <SectionBand tone="white">
      <FadeIn>
        <DestinationsSection />
      </FadeIn>
    </SectionBand>
  ),
  providers: () => (
    <SectionBand tone="sand">
      <ProvidersSection />
    </SectionBand>
  ),
  how_it_works: () => (
    <SectionBand tone="white">
      <HowItWorksSection />
    </SectionBand>
  ),
  why_choose: () => (
    <SectionBand tone="sand">
      <WhyChooseSection />
    </SectionBand>
  ),
  stats: () => <StatsSection />,
  testimonials: () => (
    <SectionBand tone="white">
      <TestimonialsSection />
    </SectionBand>
  ),
  faq: () => (
    <SectionBand tone="sand">
      <FaqSection />
    </SectionBand>
  ),
  cta: () => (
    <SectionBand tone="white">
      <CtaSection />
    </SectionBand>
  ),
};
