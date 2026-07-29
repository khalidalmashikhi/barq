"use client";

import { Mountain, Waves, Compass, Car, Tent, Camera, Fish } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

// Explore-by-category section.
//
// UX REMEDIATION (category navigation fix): every card here used to be
// a `<motion.button type="button">` with no onClick handler and no href
// at all — visually complete, animated on hover/tap, but genuinely
// inert; clicking one did nothing. Each card now carries a stable
// `slug` and is a real, keyboard-accessible link to
// "/services?category=<slug>" — the interactive element is the Link
// itself (not a nested <a>/<button>), with the motion animation applied
// to a plain inner <motion.div> purely for the hover/tap visual, exactly
// mirroring how ExperienceCard and other Link-wrapped animated cards
// already do this elsewhere in this codebase. See
// services/page.tsx's own comment for how "?category=" is resolved and
// applied, and why it is an honest, best-effort keyword filter rather
// than true categorization (no Service<->Category relationship exists
// in the schema today — confirmed, not assumed).

export function CategoryExplorer() {
  const t = useTranslations("dashboard");

  const categories = [
    { label: t("categoryMountains"), slug: "mountains", icon: Mountain },
    { label: t("categoryBeaches"), slug: "beaches", icon: Waves },
    { label: t("categoryDesert"), slug: "desert", icon: Compass },
    { label: t("categoryTransport"), slug: "transport", icon: Car },
    { label: t("categoryCamping"), slug: "camping", icon: Tent },
    { label: t("categoryPhotography"), slug: "photography", icon: Camera },
    { label: t("categoryDiving"), slug: "diving", icon: Fish },
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
            <Link
              key={category.slug}
              href={`/services?category=${category.slug}`}
              className="group flex flex-col items-center gap-2 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-2xl"
            >
              <motion.div
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/25 text-primary shadow-sm transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
              >
                <Icon size={22} strokeWidth={1.75} />
              </motion.div>
              <span className="text-xs font-medium text-foreground/70">{category.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

