"use client";

import { motion } from "framer-motion";
import { DestinationImage, DESTINATION_IMAGES } from "./destination-image";

// Popular destinations — rebuilt as real image cards for the 5 named
// places, per explicit instruction. Photos are not included (see
// destination-image.tsx's own note) — this renders correctly the
// moment real files exist at the listed paths, honest fallback until
// then.

const destinations = [
  { name: "صلالة", image: DESTINATION_IMAGES.salalah },
  { name: "الجبل الأخضر", image: DESTINATION_IMAGES.jebelAkhdar },
  { name: "وادي دربات", image: DESTINATION_IMAGES.wadiDarbat },
  { name: "رمال الشرقية", image: DESTINATION_IMAGES.sharqiyaSands },
  { name: "مسندم", image: DESTINATION_IMAGES.musandam },
];

export function PopularDestinations() {
  return (
    <div>
      <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-foreground">
        <span aria-hidden>🏝</span>
        الوجهات الأكثر زيارة
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
