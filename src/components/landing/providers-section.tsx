import { BadgeCheck, Building2 } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getProvidersForFilter } from "@/lib/services/get-services";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

// Trusted Providers — Phase F.1, landing page section 6. Real approved
// providers (getProvidersForFilter() — already existed, Services
// Marketplace sprint), not fabricated names, each shown with the
// "Verified Provider" badge — reflecting the platform's real
// Provider.status === APPROVED gate, not a marketing claim invented
// for this page.

export async function ProvidersSection() {
  const t = await getServerTranslator("landing");
  const providers = await getProvidersForFilter();
  const featured = providers.slice(0, 8);

  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-10 flex flex-col items-center gap-2 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{t("providers.title")}</h2>
          <p className="max-w-xl text-foreground/60">{t("providers.subtitle")}</p>
        </div>

        {featured.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {featured.map((provider) => (
              <div
                key={provider.id}
                className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 text-center shadow-sm"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/10 text-secondary">
                  <Building2 size={20} strokeWidth={1.75} />
                </span>
                <span className="text-sm font-medium text-foreground/80">{provider.name}</span>
                <Badge variant="info" className="gap-1">
                  <BadgeCheck size={12} strokeWidth={2} />
                  {t("providers.verifiedBadge")}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={Building2} message={t("providers.title")} padding="py-16" />
        )}
      </div>
    </section>
  );
}
