import { Compass } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getServices } from "@/lib/services/get-services";
import { ExperienceCard } from "@/components/dashboard/experience-card";
import { EmptyState } from "@/components/ui/empty-state";

// Featured Experiences — Phase F.1, landing page section 3. Real data
// (getServices() — Phase B's own Services Marketplace query), not
// fabricated cards — reuses ExperienceCard (already i18n-aware,
// already links to the real /services/[id] route) rather than a new,
// duplicate card component.

export async function FeaturedExperiencesSection() {
  const t = await getServerTranslator("landing");
  const { items } = await getServices({ pageSize: 6, sort: "newest" });

  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mb-10 flex flex-col items-end justify-between gap-4 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{t("featured.title")}</h2>
          <p className="max-w-xl text-foreground/60">{t("featured.subtitle")}</p>
        </div>
        {items.length > 0 && (
          <Link
            href="/services"
            className="shrink-0 rounded-sm text-sm font-medium text-primary transition-colors hover:text-primary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {t("featured.viewAll")} →
          </Link>
        )}
      </div>

      {items.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((service) => (
            <ExperienceCard
              key={service.id}
              serviceId={service.id}
              title={service.name}
              providerName={service.providerName}
              price={service.price}
              priceIsFrom={service.priceIsFrom}
              availability={service.bookability}
              imageAspect="premium"
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Compass}
          message={t("featured.emptyTitle")}
          description={t("featured.emptyDescription")}
          padding="py-16"
        />
      )}
    </section>
  );
}
