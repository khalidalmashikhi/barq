"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import { Clock, Heart, MapPin, Star } from "lucide-react";

import { clsx } from "@/components/ui/clsx";
import { DestinationImage } from "./destination-image";

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
  layout?: "vertical" | "horizontal";
  className?: string;
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
  layout = "vertical",
  className,
}: ExperienceCardProps) {
  const [favorited, setFavorited] = useState(false);
  const isHorizontal = layout === "horizontal";

  return (
    <motion.article
      whileHover={{ y: -4 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className={clsx(
        "group overflow-hidden rounded-2xl border border-border bg-card shadow-premium transition-shadow duration-300 hover:shadow-premium-lg",
        isHorizontal && "flex flex-col sm:flex-row",
        className
      )}
    >
      <div
        className={clsx(
          "relative overflow-hidden bg-accent/10",
          isHorizontal
            ? "h-52 w-full sm:h-auto sm:w-72 sm:shrink-0"
            : "h-56 w-full"
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

        {category ? (
          <span className="absolute start-3 top-3 rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-primary backdrop-blur-md">
            {category}
          </span>
        ) : null}

        <button
          type="button"
          onClick={() => setFavorited((current) => !current)}
          aria-label={
            favorited ? "إزالة من المفضلة" : "إضافة إلى المفضلة"
          }
          aria-pressed={favorited}
          className="absolute end-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-foreground/60 backdrop-blur-md transition-colors hover:text-danger"
        >
          <Heart
            size={15}
            strokeWidth={2}
            fill={favorited ? "currentColor" : "none"}
            className={favorited ? "text-danger" : ""}
          />
        </button>
      </div>

      <div
        className={clsx(
          "flex flex-col gap-2 p-5",
          isHorizontal && "flex-1 justify-center"
        )}
      >
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

        <h3
          className={clsx(
            "font-semibold text-foreground",
            isHorizontal ? "text-lg" : "text-base"
          )}
        >
          {title}
        </h3>

        <p className="text-sm text-foreground/50">{providerName}</p>

        <div className="mt-2 flex items-center justify-between gap-3 border-t border-border pt-3">
          <div className="flex flex-col gap-1">
            {rating !== undefined ? (
              <span className="flex items-center gap-1 text-xs font-medium text-accent-foreground">
                <Star
                  size={13}
                  strokeWidth={1.75}
                  className="text-accent"
                  fill="currentColor"
                />
                {rating.toFixed(1)}
              </span>
            ) : null}

            <span className="text-sm font-semibold text-primary">
              {price ?? "السعر غير متوفر"}
            </span>
          </div>

          <Link
            href={`/services/${serviceId}`}
            className="shrink-0 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            احجز الآن
          </Link>
        </div>
      </div>
    </motion.article>
  );
}