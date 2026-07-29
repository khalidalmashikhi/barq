import { Tent, Mountain, Waves, Landmark, Building2, Bike } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Categories — Phase F.1, landing page section 4.
//
// UX REMEDIATION (category navigation fix): these six cards previously
// all linked to the same bare "/services" — visually clickable but
// functionally identical to clicking nothing, since none of them ever
// actually narrowed the results. Each card now carries a stable `slug`
// and links to "/services?category=<slug>". services/page.tsx resolves
// that slug back to this exact translated label and applies it as a
// real, best-effort filter — see that file's own comment for exactly
// how, and why it is honestly a keyword match rather than true
// categorization: Service.serviceType is a technical CTI discriminator,
// not a business taxonomy (get-services.ts's own documented gap), and
// the real Category/SubCategory models (ADR-0013) have no relationship
// to Service at all — confirmed by inspecting prisma/schema.prisma
// directly, not assumed. Building a genuine Service<->Category link is
// a real schema change, explicitly out of scope for this fix.
const categories = [
  { key: "desertSafari", slug: "desert-safari", icon: Tent },
  { key: "mountainTours", slug: "mountain-tours", icon: Mountain },
  { key: "coastalTrips", slug: "coastal-trips", icon: Waves },
  { key: "culturalTours", slug: "cultural-tours", icon: Landmark },
  { key: "cityExperiences", slug: "city-experiences", icon: Building2 },
  { key: "adventureSports", slug: "adventure-sports", icon: Bike },
] as const;

export async function CategoriesSection() {
  const t = await getServerTranslator("landing");

  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-10 flex flex-col items-center gap-2 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{t("categories.title")}</h2>
          <p className="max-w-xl text-foreground/60">{t("categories.subtitle")}</p>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {categories.map(({ key, slug, icon: Icon }) => (
            <Link
              key={key}
              href={`/services?category=${slug}`}
              className="group flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 text-center shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <Icon size={22} strokeWidth={1.75} />
              </span>
              <span className="text-sm font-medium text-foreground/80">{t(`categories.${key}`)}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
