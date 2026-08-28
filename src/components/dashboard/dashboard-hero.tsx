"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { DestinationImage, DESTINATION_IMAGES } from "./destination-image";

// Customer Home hero — Customer Experience Polish. Replaces the former disabled
// "search" bar (a non-functional control presented as the primary action) with a
// warm greeting and a REAL primary call to action that links to the working
// services catalogue (/services). No fake/disabled controls; the greeting carries
// no fabricated personalization.
export function DashboardHero() {
  const t = useTranslations("dashboard");

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden"
      style={{ height: 360 }}
    >
      <DestinationImage src={DESTINATION_IMAGES.salalah} alt={t("heroImageAlt")} className="absolute inset-0" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/10" />
      <div aria-hidden className="absolute inset-0 bg-luxury-gradient opacity-40" />

      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
        <h1 className="max-w-2xl text-3xl font-semibold text-white sm:text-4xl">{t("heroTitle")}</h1>
        <p className="mt-3 max-w-xl text-lg text-white/80">{t("heroSubtitle")}</p>

        <Link
          href="/services"
          className="mt-8 inline-flex items-center rounded-full bg-white px-7 py-3.5 text-base font-medium text-primary shadow-premium-lg transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-white/60"
        >
          {t("homeExploreCta")}
        </Link>
      </div>
    </motion.div>
  );
}
