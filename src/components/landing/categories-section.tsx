import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { CategoryDiscoveryCard } from "@/components/categories/category-discovery-card";
import { DISCOVERY_FAMILIES } from "./discovery-families";

// Categories — landing page discovery section.
//
// BARQ v1 discovery (ADR-0016): the grid is the approved, code-defined set of
// top-level families (Cars, Tours & Experiences, Marine Trips, Transfers). This
// is deliberately NOT DB-driven: the taxonomy data bootstrap is parked, so
// reading getPublicRootCategories() would surface junk/incomplete rows and
// couple the homepage to unpopulated data. Instead each family links to the
// existing /services?category=<slug> explore surface, which resolves the slug to
// the real relational category once the taxonomy is populated and shows an honest
// empty state until then — the homepage stays clear and on-brand regardless of
// inventory. Provider type is deliberately absent here: customers browse by what
// they want to do, not by who provides it.
export async function CategoriesSection() {
  const t = await getServerTranslator("landing");

  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-10 flex flex-col items-center gap-2 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{t("categories.title")}</h2>
          <p className="max-w-xl text-foreground/60">{t("categories.subtitle")}</p>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {DISCOVERY_FAMILIES.map((family) => (
            <CategoryDiscoveryCard
              key={family.slug}
              slug={family.slug}
              label={t(family.labelKey)}
              description={t(family.descKey)}
              Icon={family.Icon}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
