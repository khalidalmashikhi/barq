"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { DestinationImage, DESTINATION_IMAGES } from "./destination-image";

// Popular destinations — rebuilt as real image cards for the 5 named
// places, per explicit instruction. Photos are not included (see
// destination-image.tsx's own note) — this renders correctly the
// moment real files exist at the listed paths, honest fallback until
// then.

export function PopularDestinations() {
  const t = useTranslations("dashboard");

  const destinations = [
    { name: t("destinationSalalah"), image: DESTINATION_IMAGES.salalah },
    { name: t("destinationJebelAkhdar"), image: DESTINATION_IMAGES.jebelAkhdar },
    { name: t("destinationWadiDarbat"), image: DESTINATION_IMAGES.wadiDarbat },
    { name: t("destinationSharqiyaSands"), image: DESTINATION_IMAGES.sharqiyaSands },
    { name: t("destinationMusandam"), image: DESTINATION_IMAGES.musandam },
  ];

  return (
    <div>
      <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-foreground">
        <span aria-hidden>🏝</span>
        {t("popularDestinationsTitle")}
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {destinations.map((destination) => (
          <motion.div
            key={destination.name}
            whileHover={{ y: -4 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="group relative h-40 overflow-hidden rounded-2xl shadow-premium"
          >
            <DestinationImage src={destination.image} alt={destination.name} className="transition-transform duration-500 group-hover:scale-105" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
            <span className="absolute bottom-3 start-3 text-sm font-semibold text-white">
              {destination.name}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
