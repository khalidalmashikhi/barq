import { BadgeCheck, MapPin, Package, Star, PackageOpen, Share2 } from "lucide-react";
import type { ProviderProfile } from "@/lib/services/get-provider-profile";
import type { ServiceListItem } from "@/lib/services/get-services";
import { ExperienceCard } from "@/components/dashboard/experience-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { ShareButton } from "@/components/ui/share-button";
import { FadeIn } from "@/components/ui/fade-in";
import { Badge } from "@/components/ui/badge";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import type { PreviewMode } from "@/lib/preview/preview-mode";

// ProviderProfileView — Unified Preview System (provider row).
//
// The SINGLE customer-facing rendering of a provider's public storefront,
// extracted VERBATIM from the public /providers/[idOrSlug] page so that page,
// the provider self-preview, and the admin preview all render the exact same
// presentation (no parallel design). Callers fetch the data and wrap this in
// their own <main>; the public page keeps its <main id="main-content"> +
// JSON-LD + Navbar/Footer, previews wrap it with a PreviewBanner.
//
// `mode` changes ONLY presentation: in a preview the ShareButton is hidden
// (sharing a not-yet-public URL is inappropriate) and JSON-LD/canonical are
// not emitted (done at the page level, public-only). Everything else — cover,
// logo, name, Verified badge, ProviderType, city, rating, description, areas,
// portfolio, published-service cards, pagination — renders identically. It
// never relaxes any read gate; authorization + which services to show are
// decided by the caller/route.

type ProviderProfileViewProps = {
  provider: ProviderProfile;
  services: { items: ServiceListItem[]; page: number; totalPages: number };
  basePath: string;
  providerUrl: string;
  page?: string;
  mode: PreviewMode;
};

export async function ProviderProfileView({
  provider,
  services,
  basePath,
  providerUrl,
  page,
  mode,
}: ProviderProfileViewProps) {
  const t = await getServerTranslator("services");
  const initial = provider.name.trim().charAt(0) || "?";

  return (
    <>
      {provider.coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- provider-supplied storage host; mirrors the logo <img> below
        <img
          src={provider.coverUrl}
          alt=""
          className="h-40 w-full rounded-2xl border border-border object-cover sm:h-56"
        />
      )}
      <FadeIn className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          {provider.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- provider.logoUrl is a plain reference URL, no next/image remotePatterns configured for arbitrary provider-supplied hosts.
            <img
              src={provider.logoUrl}
              alt=""
              className="h-16 w-16 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-secondary text-xl font-semibold text-white">
              {initial}
            </span>
          )}
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{provider.name}</h1>
              <Badge variant="info" className="gap-1">
                <BadgeCheck size={13} strokeWidth={2} />
                {t("verifiedProviderLabel")}
              </Badge>
              <span className="rounded-full bg-foreground/5 px-2.5 py-0.5 text-xs font-medium text-foreground/60">
                {provider.providerType === "INDIVIDUAL" ? t("providerTypeIndividual") : t("providerTypeCompany")}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-foreground/50">
              <span className="flex items-center gap-1.5">
                <Package size={13} strokeWidth={1.75} />
                {t("experiencesCountLabel", { count: provider.publishedServicesCount })}
              </span>
              {provider.city && (
                <span className="flex items-center gap-1.5">
                  <MapPin size={13} strokeWidth={1.75} />
                  {provider.city}
                </span>
              )}
              {provider.reviewCount > 0 && provider.averageRating !== null && (
                <span className="flex items-center gap-1.5">
                  <Star size={13} strokeWidth={1.75} className="text-accent" fill="currentColor" />
                  {t("providerRatingLabel", { rating: provider.averageRating.toFixed(1), count: provider.reviewCount })}
                </span>
              )}
            </div>
          </div>
        </div>

        {provider.description && (
          <p className="mt-4 text-sm leading-relaxed text-foreground/70">{provider.description}</p>
        )}

        {provider.categories.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-foreground/40">
              {t("providerAreasHeading")}
            </span>
            <div className="flex flex-wrap gap-2">
              {provider.categories.map((category) => (
                <Badge key={category.id} variant="info">
                  {category.label}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Sharing a not-yet-public storefront is inappropriate; public only. */}
        {mode === "public" && (
          <div className="mt-4">
            <ShareButton
              url={providerUrl}
              title={provider.name}
              text={t("shareProviderText", { providerName: provider.name })}
              label={t("shareLabel")}
              copiedLabel={t("shareCopiedLabel")}
              errorLabel={t("shareErrorLabel")}
              icon={<Share2 size={14} strokeWidth={1.75} />}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
            />
          </div>
        )}
      </FadeIn>

      {provider.portfolio.length > 0 && (
        <FadeIn delay={0.03} className="flex flex-col gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-foreground/40">{t("portfolioHeading")}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {provider.portfolio.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element -- provider-supplied storage host; mirrors the logo <img> above
              <img
                key={url}
                src={url}
                alt=""
                loading="lazy"
                className="aspect-square w-full rounded-xl border border-border object-cover"
              />
            ))}
          </div>
        </FadeIn>
      )}

      {services.items.length === 0 ? (
        <EmptyState
          icon={PackageOpen}
          iconSize={32}
          gap="gap-3"
          padding="py-16"
          message={t("providerNoServicesLabel")}
          messageClassName="text-foreground/60"
        />
      ) : (
        <FadeIn delay={0.05} className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {services.items.map((service) => (
            <ExperienceCard
              key={service.id}
              serviceId={service.id}
              title={service.name}
              providerName={service.providerName}
              price={service.price}
              imageAspect="premium"
            />
          ))}
        </FadeIn>
      )}

      <Pagination page={services.page} totalPages={services.totalPages} searchParams={{ page }} basePath={basePath} />
    </>
  );
}
