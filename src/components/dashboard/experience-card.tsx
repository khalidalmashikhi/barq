"use client";

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Clock, MapPin, Star } from "lucide-react";

import { clsx } from "@/components/ui/clsx";
import { DestinationImage } from "./destination-image";
import { BrandPattern, getBrandPatternTone } from "@/components/ui/brand-pattern";

// Service (experience) card — the customer-facing marketplace listing card.
//
// The ENTIRE card is a single link to the service detail page (marketplace
// standard). There are deliberately NO nested interactive elements — the old
// favorite-heart button was inert (no favorites backend) and has been removed,
// and the old inner "Book now" link is gone (it would have been an <a> inside an
// <a> — the exact nested-anchor hydration bug this project has hit before). One
// anchor, fully clickable, no nesting.
//
// Only truthful data renders: rating/location/duration appear only when passed;
// price falls back to a neutral "price unavailable" label, never a fabricated
// number, rating, review count, or "popular"/"best seller" badge.

type ExperienceCardProps = {
  serviceId: string;
  title: string;
  providerName: string;
  price?: string | null;
  location?: string;
  rating?: number;
  duration?: string;
  category?: string;
  imageSrc?: string;
  /**
   * Real uploaded cover media (Media Foundation, Gap C) — a remote Supabase
   * URL. When present it takes priority over `imageSrc`/the brand-pattern
   * fallback and renders via a plain lazy <img> (next/image remotePatterns
   * for the storage host is a POST-LAUNCH follow-up). Absent → existing behavior.
   */
  coverImageUrl?: string | null;
  layout?: "vertical" | "horizontal";
  className?: string;
  /**
   * "legacy" (default) keeps the original fixed-height image container.
   * "premium" switches to a fixed aspect ratio for a more considered silhouette;
   * opt in per call site so public marketing pages can differ from the dashboard.
   */
  imageAspect?: "legacy" | "premium";
};

export function ExperienceCard({
  serviceId,
  title,
  providerName,
  price,
  location,
  rating,
  duration,
  category,
  imageSrc,
  coverImageUrl,
  layout = "vertical",
  className,
  imageAspect = "legacy",
}: ExperienceCardProps) {
  const isHorizontal = layout === "horizontal";
  const tServices = useTranslations("services");

  return (
    <Link
      href={`/services/${serviceId}`}
      aria-label={title}
      className={clsx(
        "group block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        className
      )}
    >
      <motion.article
        whileHover={{ y: -4 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className={clsx(
          "overflow-hidden rounded-2xl border border-border bg-card shadow-premium transition-shadow duration-300 group-hover:shadow-premium-lg",
          isHorizontal && "flex flex-col sm:flex-row"
        )}
      >
        <div
          className={clsx(
            "relative overflow-hidden bg-accent/10",
            isHorizontal
              ? "h-52 w-full sm:h-auto sm:w-72 sm:shrink-0"
              : imageAspect === "premium"
                ? "aspect-[4/3] w-full"
                : "h-56 w-full"
          )}
        >
          {coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- provider-supplied Supabase host; next/image remotePatterns is a POST-LAUNCH follow-up
            <img
              src={coverImageUrl}
              alt={title}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : imageSrc ? (
            <DestinationImage
              src={imageSrc}
              alt={title}
              className="transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-accent/10 text-primary/25">
              <BrandPattern tone={getBrandPatternTone(serviceId || title)} className="absolute inset-0" />
              <MapPin size={28} strokeWidth={1.5} className="relative" />
            </div>
          )}

          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/25 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          />

          {category ? (
            <span className="absolute start-3 top-3 rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-primary backdrop-blur-md">
              {category}
            </span>
          ) : null}
        </div>

        <div className={clsx("flex flex-col gap-2 p-5", isHorizontal && "flex-1 justify-center")}>
          <h3 className="text-lg font-semibold leading-snug tracking-tight text-foreground">{title}</h3>

          <p className="text-sm text-foreground/50">{providerName}</p>

          {location || duration ? (
            <div className="flex items-center justify-between gap-3 text-xs text-foreground/50">
              {location ? (
                <span className="flex items-center gap-1">
                  <MapPin size={13} strokeWidth={1.75} />
                  {location}
                </span>
              ) : (
                <span />
              )}

              {duration ? (
                <span className="flex items-center gap-1">
                  <Clock size={13} strokeWidth={1.75} />
                  {duration}
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="mt-2 flex items-center justify-between gap-3 border-t border-border pt-3">
            <div className="flex flex-col gap-1">
              {rating !== undefined ? (
                <span className="flex items-center gap-1 text-xs font-medium text-accent-foreground">
                  <Star size={13} strokeWidth={1.75} className="text-accent" fill="currentColor" />
                  {rating.toFixed(1)}
                </span>
              ) : null}

              <span className="text-sm font-semibold text-primary">
                {price ?? tServices("priceUnavailableLabel")}
              </span>
            </div>

            {/* Non-interactive affordance — the whole card is the link. */}
            <span
              aria-hidden
              className="shrink-0 text-xs font-medium text-primary/70 transition-colors group-hover:text-primary"
            >
              {tServices("viewDetailsLabel")}
            </span>
          </div>
        </div>
      </motion.article>
    </Link>
  );
}
