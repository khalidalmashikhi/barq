"use client";

import { Mountain, Waves, Compass, Car, Tent, Camera, Fish } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";

// Explore-by-category section. Visually complete but not wired to
// real filtering/navigation yet (no Experience/Category data model
// exists in this project).

export function CategoryExplorer() {
  const t = useTranslations("dashboard");

  const categories = [
    { label: t("categoryMountains"), icon: Mountain },
    { label: t("categoryBeaches"), icon: Waves },
    { label: t("categoryDesert"), icon: Compass },
    { label: t("categoryTransport"), icon: Car },
    { label: t("categoryCamping"), icon: Tent },
    { label: t("categoryPhotography"), icon: Camera },
    { label: t("categoryDiving"), icon: Fish },
  ];

  return (
    <div>
      <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-foreground">
        <span aria-hidden>🧭</span>
        {t("exploreByCategoryTitle")}
      </h2>
      <div className="flex flex-wrap gap-4 sm:gap-6">
        {categories.map((category) => {
          const Icon = category.icon;
          return (
            <motion.button
              key={category.label}
              type="button"
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.97 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="group flex flex-col items-center gap-2 text-center"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/25 text-primary shadow-sm transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <Icon size={22} strokeWidth={1.75} />
              </div>
              <span className="text-xs font-medium text-foreground/70">{category.label}</span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

