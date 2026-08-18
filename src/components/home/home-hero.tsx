import { Search } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { homeGovernorateHref } from "@/lib/discovery/home-nav";
import { regionLabelKey } from "@/lib/regions";
import { clsx } from "@/components/ui/clsx";

// HOME-1 — Layer 1: HERO / SEARCH / GOVERNORATE.
//
// Deliberately compact (no full-bleed photo panel, no dual CTAs): one concise
// headline, one supporting line, the marketplace search, and the governorate
// scope selector — nothing else. Reuses the EXISTING hero.* copy (title/subtitle/
// search) rather than inventing new strings.
//
// Search is a plain GET form to /services (reuses its `q` param) — zero client JS.
// Governorate chips are plain <Link>s that re-scope the HOME itself
// (homeGovernorateHref → "/?region=CODE"); the page re-reads getHomeDiscovery for
// that region, so the previews below update. "All Oman" clears the scope. No
// client-side filtering is duplicated here — the server read model is the single
// source of the scoped data.

type HomeHeroProps = {
  governorates: { code: string; labelKey: string }[];
  selectedGovernorate: string | null;
};

export async function HomeHero({ governorates, selectedGovernorate }: HomeHeroProps) {
  const t = await getServerTranslator("landing");
  const tCommon = await getServerTranslator("common");

  const chipBase =
    "rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
  const chipActive = "bg-primary text-primary-foreground shadow-premium";
  const chipIdle = "border border-border bg-card text-foreground/70 hover:bg-primary/5 hover:text-primary";

  return (
    <section className="relative overflow-hidden px-6 py-16 sm:py-20">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 text-center">
        <span className="rounded-full bg-primary/10 px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-primary">
          {t("hero.eyebrow")}
        </span>

        <h1 className="text-4xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-5xl">
          {t("hero.title")}
        </h1>

        <p className="max-w-xl text-lg leading-relaxed text-foreground/60">{t("hero.subtitle")}</p>

        <form action="/services" method="GET" role="search" className="w-full max-w-xl">
          <div className="flex items-center gap-2 rounded-full border border-border bg-card p-2 shadow-premium-lg">
            <Search size={20} strokeWidth={2} className="ms-3 shrink-0 text-foreground/40" aria-hidden />
            <input
              type="search"
              name="q"
              aria-label={t("home.searchAria")}
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

        <nav aria-label={t("home.governorateAria")} className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <Link
            href={homeGovernorateHref(null)}
            aria-current={selectedGovernorate === null ? "page" : undefined}
            className={clsx(chipBase, selectedGovernorate === null ? chipActive : chipIdle)}
          >
            {t("home.allOman")}
          </Link>
          {governorates.map((gov) => {
            const active = selectedGovernorate === gov.code;
            const labelKey = regionLabelKey(gov.code);
            if (!labelKey) return null;
            return (
              <Link
                key={gov.code}
                href={homeGovernorateHref(gov.code)}
                aria-current={active ? "page" : undefined}
                className={clsx(chipBase, active ? chipActive : chipIdle)}
              >
                {tCommon(labelKey)}
              </Link>
            );
          })}
        </nav>
      </div>
    </section>
  );
}
