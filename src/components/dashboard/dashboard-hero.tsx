"use client";

import { motion } from "framer-motion";
import { Search } from "lucide-react";

// Dashboard hero — extracted from dashboard/page.tsx for clarity. Full
// width, premium gradient, centered search, Framer Motion slide-in per
// explicit "Hero slides" instruction.
//
// Background illustration: a restrained abstract geometric line motif
// (kept from earlier passes) stands in for "elegant travel
// illustrations" — genuine custom illustration art isn't something
// this process can produce; the abstract motif is honest about being
// abstract, not a disguised attempt at literal illustration.

export function DashboardHero() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden bg-luxury-gradient px-8 py-16"
    >
      <svg
        aria-hidden
        className="pointer-events-none absolute -top-20 end-0 h-80 w-80 text-white/[0.06]"
        viewBox="0 0 100 100"
        fill="none"
      >
        <path d="M50 5 L95 50 L50 95 L5 50 Z" stroke="currentColor" strokeWidth="0.5" />
        <path d="M50 25 L75 50 L50 75 L25 50 Z" stroke="currentColor" strokeWidth="0.5" />
      </svg>

      <div className="relative z-10 mx-auto max-w-3xl text-center">
        <h1 className="text-3xl font-semibold text-white sm:text-4xl">مرحباً بك 👋</h1>
        <p className="mt-3 text-lg text-white/70">اكتشف أجمل التجارب السياحية في عمان</p>

        <div className="mx-auto mt-8 flex max-w-xl items-center gap-2 rounded-full bg-white p-2 shadow-premium-lg">
          <Search size={18} strokeWidth={1.75} className="ms-3 text-foreground/40" />
          <input
            type="search"
            placeholder="إلى أين تريد الذهاب؟"
            className="w-full bg-transparent px-1 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
            disabled
          />
          <button
            type="button"
            className="shrink-0 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            ابحث
          </button>
        </div>
      </div>
    </motion.div>
  );
}
