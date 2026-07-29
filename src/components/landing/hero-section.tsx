import { Search } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { HeroVisual } from "./hero-visual";

// Hero + Search — Phase F.1 (UI/UX Redesign Foundation), landing page
// sections 1–2. Search is folded into the Hero visually (one full-bleed
// panel), matching how Airbnb/Booking.com/GetYourGuide present their
// own homepage search — not a separate section stacked below it.
//
// The search form is a plain HTML GET to /services?q=... — no client
// JS required, works instantly, and reuses /services' own already
// -existing `q` search param (src/lib/services/get-services.ts's
// `search` filter) rather than inventing a new search mechanism.
//
// Phase 3 Wave 2: restructured to an asymmetric 2-column layout (text
// left, HeroVisual image panel right) on a light background, replacing
// Wave 1's centered text-over-dark-gradient treatment — that pattern
// read as a generic template regardless of how it was polished. The
// dark gradient now lives only inside HeroVisual's placeholder fill,
// not the whole section. See hero-visual.tsx for the real-photo-slot
// mechanism and why no photo is passed yet.

export async function HeroSection() {
  const t = await getServerTranslator("landing");

  return (
    <section className="relative overflow-hidden px-6 py-20 sm:py-28">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div className="flex animate-fade-up flex-col items-center gap-6 text-center lg:items-start lg:text-start">
          <span className="rounded-full bg-primary/10 px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-primary">
            {t("hero.eyebrow")}
          </span>

          <h1 className="text-4xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            {t("hero.title")}
          </h1>

          <p className="max-w-xl text-lg leading-relaxed text-foreground/60">{t("hero.subtitle")}</p>

          <form action="/services" method="GET" className="w-full max-w-xl">
            <div className="flex items-center gap-2 rounded-full border border-border bg-card p-2 shadow-premium-lg">
              <Search size={20} strokeWidth={2} className="ms-3 shrink-0 text-foreground/40" aria-hidden />
              <input
                type="search"
                name="q"
                placeholder={t("hero.searchPlaceholder")}
                className="min-w-0 flex-1 bg-transparent px-1 py-2.5 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
              />
              <button
                type="submit"
                className="shrink-0 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {t("hero.searchButton")}
              </button>
            </div>
          </form>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-4 lg:justify-start">
            <Link
              href="/services"
              className="rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-premium transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {t("hero.ctaPrimary")}
            </Link>
            <a
              href="#how-it-works"
              className="rounded-full border border-primary/25 px-6 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {t("hero.ctaSecondary")}
            </a>
          </div>
        </div>

        <HeroVisual alt={t("hero.title")} caption={t("hero.photoComingSoon")} />
      </div>
    </section>
  );
}
