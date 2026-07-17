"use client";

import { motion } from "framer-motion";
import { Search, MapPin, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { DestinationImage, DESTINATION_IMAGES } from "./destination-image";

export function DashboardHero() {
  const t = useTranslations("dashboard");

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden"
      style={{ height: 420 }}
    >
      <DestinationImage src={DESTINATION_IMAGES.salalah} alt={t("heroImageAlt")} className="absolute inset-0" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/10" />
      <div aria-hidden className="absolute inset-0 bg-luxury-gradient opacity-40" />

      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
        <h1 className="max-w-2xl text-3xl font-semibold text-white sm:text-4xl">
          {t("heroTitle")}
        </h1>
        <p className="mt-3 text-lg text-white/75">{t("heroSubtitle")}</p>

        <div className="mx-auto mt-8 flex w-full max-w-2xl items-center gap-2 rounded-full bg-white p-2.5 shadow-premium-lg">
          <Search size={20} strokeWidth={1.75} className="ms-3 text-foreground/40" />
          <input
            type="search"
            placeholder={t("heroSearchPlaceholder")}
            className="w-full bg-transparent px-1 py-2.5 text-base text-foreground placeholder:text-foreground/40 focus:outline-none"
            disabled
          />
          <span className="hidden h-6 w-px bg-border sm:block" />
          <button type="button" className="hidden items-center gap-1.5 px-3 text-sm text-foreground/60 sm:flex" aria-label={t("locationLabel")}>
            <MapPin size={16} strokeWidth={1.75} />
            {t("locationLabel")}
          </button>
          <button type="button" className="hidden rounded-full p-2.5 text-foreground/60 hover:bg-background sm:flex" aria-label={t("filterLabel")}>
            <SlidersHorizontal size={16} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="shrink-0 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {t("searchButtonLabel")}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
