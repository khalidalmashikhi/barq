"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Star, MapPin, Clock, Heart } from "lucide-react";
import { DestinationImage } from "./destination-image";
import { clsx } from "@/components/ui/clsx";

// Experience card — full rebuild per explicit "current yellow
// placeholders are unacceptable" feedback. Real fields added: category
// badge, duration, favorite button. Uses DestinationImage (real photo
// path + honest fallback, not a fabricated gradient) and Framer Motion
// for the hover lift, per explicit "use Framer Motion" instruction.
//
// Favorite button is visually real but not wired to persistence — no
// Favorites data model exists in BARQ yet (same honesty standard as
// every other non-backed interaction in this project); it does toggle
// its own local visual state so it doesn't feel broken to interact
// with, without claiming to save anything server-side.

type ExperienceCardProps = {
  title: string;
  location?: string;
  providerName: string;
  price?: string | null;
  rating?: number;
  duration?: string;
  category?: string;
  imageSrc?: string;
  layout?: "vertical" | "horizontal";
  className?: string;
};

export function ExperienceCard({
  title,
  location,
  providerName,
  price,
  rating,
  duration,
  category,
  imageSrc,
  layout = "vertical",
  className,
}: ExperienceCardProps) {
  const [favorited, setFavorited] = useState(false);
  const isHorizontal = layout === "horizontal";

  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className={clsx(
        "group overflow-hidden rounded-2xl border border-border bg-card shadow-premium transition-shadow duration-300 hover:shadow-premium-lg",
        isHorizontal ? "flex flex-col sm:flex-row" : "",
        className
      )}
    >
      <div
        className={clsx(
          "relative overflow-hidden bg-accent/10",
          isHorizontal ? "h-52 w-full sm:h-auto sm:w-72 sm:shrink-0" : "h-56 w-full"
        )}
      >
        {imageSrc ? (
          <DestinationImage
            src={imageSrc}
            alt={title}
            className="transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-accent/15 text-primary/25">
            <MapPin size={28} strokeWidth={1.5} />
          </div>
        )}

        {category && (
          <span className="absolute start-3 top-3 rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-primary backdrop-blur-md">
            {category}
          </span>
        )}

        <button
          type="button"
          onClick={() => setFavorited((v: boolean) => !v)}
          aria-label="إضافة إلى المفضلة"
          aria-pressed={favorited}
          className="absolute end-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-foreground/60 backdrop-blur-md transition-colors hover:text-danger"
        >
          <Heart size={15} strokeWidth={2} fill={favorited ? "currentColor" : "none"} className={favorited ? "text-danger" : ""} />
        </button>
      </div>

      <div className={clsx("flex flex-col gap-2 p-5", isHorizontal && "flex-1 justify-center")}>
        {(location || duration) && (
          <div className="flex items-center justify-between text-xs text-foreground/50">
            {location && (
              <span className="flex items-center gap-1">
                <MapPin size={13} strokeWidth={1.75} />
                {location}
              </span>
            )}
            {duration && (
              <span className="flex items-center gap-1">
                <Clock size={13} strokeWidth={1.75} />
                {duration}
              </span>
            )}
          </div>
        )}

        <h3 className={clsx("font-semibold text-foreground", isHorizontal ? "text-lg" : "text-base")}>
          {title}
        </h3>
        <p className="text-sm text-foreground/50">{providerName}</p>

        <div className="mt-2 flex items-center justify-between gap-3 border-t border-border pt-3">
          <div className="flex flex-col">
            {rating !== undefined && (
              <span className="flex items-center gap-1 text-xs font-medium text-accent-foreground">
                <Star size={13} strokeWidth={1.75} className="text-accent" fill="currentColor" />
                {rating.toFixed(1)}
              </span>
            )}
            <span className="text-sm font-semibold text-primary">{price ?? "السعر غير متوفر"}</span>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            احجز الآن
          </button>
        </div>
      </div>
    </motion.div>
  );
}
