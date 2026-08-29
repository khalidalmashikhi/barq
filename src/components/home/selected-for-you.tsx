import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { regionLabelKey } from "@/lib/regions";
import { serviceCardHref } from "@/lib/discovery/home-nav";
import { bookabilityLabelKey, isBookable } from "@/lib/services/bookability";
import type { DiscoveryCard } from "@/lib/discovery/get-home-discovery";
import { HomeServiceCard } from "./home-service-card";

// HOME-1 — Layer 3: SELECTED FOR YOU (مختارات لك).
//
// A clean, bounded horizontal carousel of the read model's DETERMINISTIC
// `recommended` list (newest published, region-scoped) — explicitly NOT AI or
// personalized. Pure CSS scroll-snap: no client JS, native touch swipe on mobile,
// and correct RTL direction for Arabic (the row follows the document dir; nothing
// is hard-coded left-to-right). Renders nothing when there is nothing to show
// (honest empty — no skeletons, no filler).

type SelectedForYouProps = {
  items: DiscoveryCard[];
};

export async function SelectedForYou({ items }: SelectedForYouProps) {
  if (items.length === 0) return null;

  const t = await getServerTranslator("landing");
  const tCommon = await getServerTranslator("common");
  const tServices = await getServerTranslator("services");

  return (
    <section aria-labelledby="home-selected-heading" className="px-6 py-12 sm:py-16">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-1">
          <h2 id="home-selected-heading" className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {t("home.selectedForYou")}
          </h2>
          <p className="text-sm text-foreground/60">{t("home.selectedForYouSubtitle")}</p>
        </div>

        {/* Scroll-snap track: touch-swipe on mobile, a clean row on desktop, RTL-native. */}
        <ul className="-mx-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {items.map((card) => {
            const labelKey = regionLabelKey(card.regionCode);
            const locationLabel = labelKey ? tCommon(labelKey) : null;
            // "From" ONLY when the headline is genuinely a floor (multiple active prices);
            // a single price shows bare — the card no longer claims a minimum it isn't.
            const priceLabel = card.price
              ? card.priceIsFrom
                ? t("home.priceFrom", { price: card.price })
                : card.price
              : null;
            return (
              <li key={card.id} className="w-64 shrink-0 snap-start sm:w-72">
                <HomeServiceCard
                  href={serviceCardHref(card.id)}
                  name={card.name}
                  coverUrl={card.coverUrl}
                  locationLabel={locationLabel}
                  priceLabel={priceLabel}
                  availabilityLabel={tServices(bookabilityLabelKey(card.bookability))}
                  available={isBookable(card.bookability)}
                  seed={card.id}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
