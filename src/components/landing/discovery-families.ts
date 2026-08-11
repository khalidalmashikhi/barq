import { Car, Compass, Ship, Bus, type LucideIcon } from "lucide-react";

// BARQ v1 customer discovery families (ADR-0016). The approved top-level
// marketplace entry points, defined in CODE (not read from the DB) so the
// homepage presents a clear, on-brand discovery model even while the taxonomy
// data bootstrap is parked — no junk categories, no fabricated rows. Each links
// to the existing /services?category=<slug> explore surface; the services page's
// dual read resolves the slug to the real relational category once the taxonomy
// is populated, and shows an honest empty state until then. Slugs match
// ADR-0016 / the staging-taxonomy bootstrap's APPROVED_ROOTS exactly.
export type DiscoveryFamily = {
  slug: string;
  /** landing-namespace key (nested under `categories`). */
  labelKey: string;
  /** landing-namespace key (nested under `categories`). */
  descKey: string;
  Icon: LucideIcon;
};

// `as const` keeps labelKey/descKey as literal message keys (assignable to
// next-intl's typed t()), not widened to `string`.
export const DISCOVERY_FAMILIES = [
  { slug: "cars", labelKey: "categories.carsLabel", descKey: "categories.carsDesc", Icon: Car },
  { slug: "tours-experiences", labelKey: "categories.toursLabel", descKey: "categories.toursDesc", Icon: Compass },
  { slug: "marine-trips", labelKey: "categories.marineLabel", descKey: "categories.marineDesc", Icon: Ship },
  { slug: "transfers", labelKey: "categories.transfersLabel", descKey: "categories.transfersDesc", Icon: Bus },
] as const satisfies readonly DiscoveryFamily[];
