import { MapPin } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { clsx } from "@/components/ui/clsx";
import { BrandPattern, getBrandPatternTone } from "@/components/ui/brand-pattern";

// HOME-1 — the minimal customer service card used by "Selected for you".
//
// Honours the minimal DiscoveryCard DTO exactly: a large cover image, the title,
// ONE location fact, and a starting price — nothing else. Deliberately NO
// provider name/bio, description, status/verification badge, rating, or id. The
// whole card is a single <Link> (no nested anchors — the project's known
// nested-<a> hydration hazard). Pure/presentational: every string arrives already
// resolved, so this file has no i18n or data access and is trivially testable.

type HomeServiceCardProps = {
  href: string;
  name: string;
  /** Real uploaded Supabase cover URL, or null → approved brand-pattern fallback. */
  coverUrl: string | null;
  /** Already-localized governorate label, or null when the region is unknown. */
  locationLabel: string | null;
  /** Already-localized "From {price}" label, or null when no active price. */
  priceLabel: string | null;
  /** Fallback-pattern seed so cards look stable/distinct without a cover. */
  seed: string;
  className?: string;
};

export function HomeServiceCard({ href, name, coverUrl, locationLabel, priceLabel, seed, className }: HomeServiceCardProps) {
  return (
    <Link
      href={href}
      aria-label={name}
      className={clsx(
        "group block overflow-hidden rounded-2xl border border-border bg-card shadow-premium transition-shadow duration-300 hover:shadow-premium-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        className,
      )}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-accent/10">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- provider-supplied Supabase host; next/image remotePatterns is a POST-LAUNCH follow-up
          <img
            src={coverUrl}
            alt={name}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-accent/10 text-primary/25">
            <BrandPattern tone={getBrandPatternTone(seed)} className="absolute inset-0" />
            <MapPin size={28} strokeWidth={1.5} className="relative" aria-hidden />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5 p-4">
        <h3 className="line-clamp-2 text-base font-semibold leading-snug tracking-tight text-foreground">{name}</h3>

        {locationLabel ? (
          <span className="flex items-center gap-1 text-xs text-foreground/65">
            <MapPin size={13} strokeWidth={1.75} aria-hidden />
            {locationLabel}
          </span>
        ) : null}

        {priceLabel ? <span className="mt-1 text-sm font-semibold text-primary">{priceLabel}</span> : null}
      </div>
    </Link>
  );
}
