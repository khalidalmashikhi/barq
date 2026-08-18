import { MapPin } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { regionLabelKey } from "@/lib/regions";
import { governorateBrowseHref } from "@/lib/discovery/home-nav";
import type { HomeGovernorate } from "@/lib/discovery/get-home-discovery";
import { BrandPattern, getBrandPatternTone } from "@/components/ui/brand-pattern";

// HOME-1 — Layer 4: EXPLORE OMAN.
//
// A small, honest governorate grid built from the SAME governed region metadata
// (code + label) — no invented destination photography, no fabricated blurbs or
// counts. Each card is a graphic tile (brand pattern + governorate name) that
// enters the browse surface already scoped to that governorate
// (governorateBrowseHref → /services?region=CODE).

type ExploreOmanProps = {
  destinations: HomeGovernorate[];
};

export async function ExploreOman({ destinations }: ExploreOmanProps) {
  if (destinations.length === 0) return null;

  const t = await getServerTranslator("landing");
  const tCommon = await getServerTranslator("common");

  return (
    <section aria-labelledby="home-explore-heading" className="px-6 py-12 sm:py-16">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-1">
          <h2 id="home-explore-heading" className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {t("home.exploreOman")}
          </h2>
          <p className="text-sm text-foreground/60">{t("home.exploreOmanSubtitle")}</p>
        </div>

        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {destinations.map((gov) => {
            const labelKey = regionLabelKey(gov.code);
            if (!labelKey) return null;
            return (
              <li key={gov.code}>
                <Link
                  href={governorateBrowseHref(gov.code)}
                  className="group relative flex h-28 items-end overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-premium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <BrandPattern tone={getBrandPatternTone(gov.code)} className="absolute inset-0 opacity-70" />
                  <span className="relative flex items-center gap-1.5 p-4 text-sm font-semibold text-foreground">
                    <MapPin size={14} strokeWidth={1.75} aria-hidden />
                    {tCommon(labelKey)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
