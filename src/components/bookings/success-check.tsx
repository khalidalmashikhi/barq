"use client";

import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";

// Success illustration — Phase F.2 (goal 5, Booking Confirmation).
// A tasteful scale/fade entrance for the existing CheckCircle2 icon —
// framer-motion is already a project dependency (DashboardHero,
// AppSidebar). Respects prefers-reduced-motion via globals.css's
// existing blanket animation-duration override.

export function SuccessCheck() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="flex h-20 w-20 items-center justify-center rounded-full bg-success/10"
    >
      <CheckCircle2 size={44} strokeWidth={1.5} className="text-success" />
    </motion.div>
  );
}
