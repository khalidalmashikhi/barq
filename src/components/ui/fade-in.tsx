"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";

// Generic fade-up entrance wrapper — Phase F.2 (goal 14, Motion).
// Lets a Server Component page get a tasteful section entrance without
// itself becoming a Client Component — only this thin wrapper is
// "use client", matching the same pattern DashboardHero already
// established. Reduced-motion is honored via framer-motion's own
// <MotionConfig reducedMotion="user"> mounted at the root layout
// (Phase 3 Wave 1 fix) — the CSS-level prefers-reduced-motion rule in
// globals.css has no effect on framer-motion's RAF/WAAPI-driven
// animations, so that alone was never actually covering this.

type FadeInProps = {
  children: ReactNode;
  delay?: number;
  className?: string;
};

export function FadeIn({ children, delay = 0, className }: FadeInProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1], delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
