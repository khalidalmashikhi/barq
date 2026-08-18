import { Link } from "@/i18n/navigation";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { DISCOVERY_GROUP_KEYS, type DiscoveryGroupKey } from "@/lib/discovery/discovery-groups";
import { discoveryNavItems } from "@/lib/discovery/home-nav";
import { discoveryIcon } from "./discovery-icons";

// HOME-1 — Layer 2: WHAT ARE YOU LOOKING FOR?
//
// The six approved discovery groups, in canonical registry order, each a single
// icon + label card. Classification is the app-owned registry's authority
// (discoveryNavItems → sortOrder), NEVER a label or the serviceTypeKey vertical.
// A card carries ONLY an icon and a label — no description, count, badge, price,
// or rating. MORE is a navigation entry into the broader /services browse
// surface (discoveryGroupHref), never a random service bucket.
//
// Region-aware: the active governorate (if any) rides along in each href so the
// destination listing opens already scoped to the same governorate the visitor
// picked in the hero.

// Typed bridge group-key -> its "landing" message key. Co-located and
// `satisfies`-checked so a renamed/removed key is a compile error, and so the
// literal keys stay assignable to the strict next-intl translator.
const GROUP_LABEL_KEY = {
  EXPERIENCES: "discoveryExperiences",
  TOURIST_GUIDES: "discoveryTouristGuides",
  TRANSPORT: "discoveryTransport",
  CAR_RENTAL: "discoveryCarRental",
  MARINE_TRIPS: "discoveryMarineTrips",
  MORE: "discoveryMore",
} as const satisfies Record<DiscoveryGroupKey, string>;

const CARD_CLASSNAME =
  "group flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 text-center shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

type DiscoveryGridProps = {
  region: string | null;
};

export async function DiscoveryGrid({ region }: DiscoveryGridProps) {
  const t = await getServerTranslator("landing");
  const items = discoveryNavItems(region);

  return (
    <section aria-labelledby="home-discovery-heading" className="px-6 py-12 sm:py-16">
      <div className="mx-auto max-w-6xl">
        <h2
          id="home-discovery-heading"
          className="mb-8 text-center text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
        >
          {t("home.whatLookingFor")}
        </h2>

        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {items.map((item) => {
            const Icon = discoveryIcon(item.iconKey);
            return (
              <li key={item.key}>
                <Link href={item.href} className={CARD_CLASSNAME}>
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <Icon size={22} strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="text-sm font-semibold text-foreground/90">
                    {t(GROUP_LABEL_KEY[item.key as DiscoveryGroupKey])}
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

// Re-exported for tests that assert canonical order without importing the registry.
export const HOME_DISCOVERY_ORDER = DISCOVERY_GROUP_KEYS;
