import { Tent, Mountain, Waves, Landmark, Building2, Bike, Compass, type LucideIcon } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getPublicRootCategories } from "@/lib/categories/get-public-root-categories";
import { CategoryDiscoveryCard } from "@/components/categories/category-discovery-card";

// Categories — landing page section 4.
//
// Gap A (homepage real taxonomy): the grid is now driven by the real,
// admin-managed PUBLIC ROOT categories (getPublicRootCategories) whose slugs
// resolve through services/page.tsx's dual read to a relational Service.categoryId
// filter (B2). An admin creating/reordering/hiding a PUBLIC root category is
// reflected here directly — no hardcoded taxonomy, no showOnHomepage/isFeatured
// boolean, no schema change.
//
// SAFE FALLBACK: until the DB-driven path is proven on staging (and PUBLIC root
// categories are actually seeded), an EMPTY read falls back to the original six
// hardcoded marketing cards below, so the homepage never renders an empty grid.
// Once proven, delete `FALLBACK_CATEGORIES` and the fallback branch — nothing
// else references them. Real categories use a generic icon until Category
// intrinsic icons (Task A) exist; the fallback keeps its per-slug icons.
const FALLBACK_CATEGORIES = [
  { key: "desertSafari", slug: "desert-safari", icon: Tent },
  { key: "mountainTours", slug: "mountain-tours", icon: Mountain },
  { key: "coastalTrips", slug: "coastal-trips", icon: Waves },
  { key: "culturalTours", slug: "cultural-tours", icon: Landmark },
  { key: "cityExperiences", slug: "city-experiences", icon: Building2 },
  { key: "adventureSports", slug: "adventure-sports", icon: Bike },
] as const;

type CategoryCard = { key: string; slug: string; label: string; Icon: LucideIcon };

export async function CategoriesSection() {
  const t = await getServerTranslator("landing");
  const realCategories = await getPublicRootCategories();

  const cards: CategoryCard[] =
    realCategories.length > 0
      ? realCategories.map((category) => ({ key: category.id, slug: category.slug, label: category.label, Icon: Compass }))
      : FALLBACK_CATEGORIES.map((category) => ({
          key: category.key,
          slug: category.slug,
          label: t(`categories.${category.key}`),
          Icon: category.icon,
        }));

  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-10 flex flex-col items-center gap-2 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{t("categories.title")}</h2>
          <p className="max-w-xl text-foreground/60">{t("categories.subtitle")}</p>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {cards.map(({ key, slug, label, Icon }) => (
            <CategoryDiscoveryCard key={key} slug={slug} label={label} Icon={Icon} />
          ))}
        </div>
      </div>
    </section>
  );
}
