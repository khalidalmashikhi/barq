"use client";

import { motion } from "framer-motion";
import { Compass, CalendarCheck, Bell, Heart, Settings } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { clsx } from "@/components/ui/clsx";

// "Account type" is intentionally generic ("عميل") rather than a real
// role lookup — doing that properly requires querying RBAC, which this
// pass does not touch (auth/RBAC preserved exactly, per instruction).

const navItems = [
  { label: "نظرة عامة", icon: Compass, active: true, badge: 0 },
  { label: "الحجوزات", icon: CalendarCheck, active: false, badge: 0 },
  { label: "الإشعارات", icon: Bell, active: false, badge: 3 },
  { label: "المحفوظات", icon: Heart, active: false, badge: 0 },
  { label: "الإعدادات", icon: Settings, active: false, badge: 0 },
];

export function DashboardSidebar() {
  return (
    <motion.aside
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="hidden flex-col bg-card px-4 py-8 md:flex"
      style={{ width: 260 }}
    >
      <div className="flex justify-center">
        <Logo className="h-20 max-w-[90px]" />
      </div>

      <nav className="mt-10 flex flex-col gap-1.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <span
              key={item.label}
              aria-disabled={!item.active}
              aria-current={item.active ? "page" : undefined}
              className={clsx(
                "group relative flex items-center gap-3 rounded-xl px-3.5 py-3 text-[0.9rem] font-medium transition-all duration-200",
                item.active
                  ? "bg-accent/25 text-primary"
                  : "cursor-not-allowed text-foreground/35 hover:bg-background hover:text-foreground/45"
              )}
            >
              <Icon size={18} strokeWidth={1.75} className={item.active ? "text-primary" : "text-foreground/30"} />
              {item.label}
              {item.badge > 0 && (
                <span className="ms-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[0.65rem] font-semibold text-white">
                  {item.badge}
                </span>
              )}
            </span>
          );
        })}
      </nav>

      <div className="mt-auto flex items-center gap-3 rounded-xl border border-border p-3">
        <div className="h-10 w-10 shrink-0 rounded-full bg-gradient-to-br from-primary to-secondary" />
        <div className="flex flex-col overflow-hidden">
          <span className="truncate text-sm font-medium text-foreground">حسابي</span>
          <span className="truncate text-xs text-foreground/40">عميل</span>
        </div>
      </div>
    </motion.aside>
  );
}
