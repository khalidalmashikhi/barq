"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Logo } from "@/components/ui/logo";
import { clsx } from "@/components/ui/clsx";

// AppSidebar — AppShell Migration (Stabilization).
//
// Generalized from the former, Customer-only src/components/dashboard/
// sidebar.tsx: role-specific nav items are now supplied by the caller
// (Customer today; Provider/Admin/Staff later) rather than hardcoded
// here, per the approved AppShell architecture decision. Visual
// output for the Customer dashboard is preserved exactly — same
// classes, same widths, same profile block — only the data source and
// active-state logic changed.
//
// FIXES A REAL PRE-EXISTING DEFECT: the original component's `active`
// flags were hardcoded booleans (`active: true` on exactly one item,
// always, regardless of which page was actually being viewed) — every
// item was also a plain non-interactive <span>, never an actual link,
// so nothing was clickable at all. This version derives active state
// from the real current pathname via usePathname(), and renders a real
// <Link> for any item whose `href` corresponds to an existing route.
// Items with no `href` (no built destination exists yet — Notifications/
// Favorites/Settings) remain exactly as before: visible, but
// non-interactive placeholders — no route was invented to make them
// "work," which would be dishonest per this project's own established
// empty-state philosophy.
//
// ICON PROP SHAPE, DELIBERATE: `icon` is a pre-rendered ReactNode
// (e.g. `<Compass size={18} strokeWidth={1.75} />`), not a raw Lucide
// component reference. This sidesteps any uncertainty about passing a
// bare component reference across the Server->Client boundary (no
// existing pattern in this codebase does that from a Server Component
// into a "use client" one) — a rendered ReactNode is a well-supported,
// ordinary prop across that boundary. Active/inactive tinting is
// applied via a wrapping element relying on Lucide's default
// `currentColor` stroke, not by re-rendering the icon with a different
// className.

export type AppNavItem = {
  label: string;
  href?: string;
  icon: ReactNode;
  badge?: number;
};

type AppSidebarProps = {
  navItems: AppNavItem[];
  roleLabel: string;
};

export function AppSidebar({ navItems, roleLabel }: AppSidebarProps) {
  const pathname = usePathname();

  // Active-route matching (Phase 2: Service Detail Workspace) — a nav
  // item is active if the current pathname is exactly its href, or is
  // nested under it (pathname starts with `${href}/`). Among every
  // item that matches, only the one with the LONGEST href is treated
  // as active, rather than marking every matching item active. This is
  // behaviorally equivalent to "exact match OR prefix match, excluding
  // the role's own root from prefix matching" without hardcoding which
  // href is "the root": a root href (e.g. /provider, /dashboard) is,
  // by construction, always the shortest possible match, so it
  // naturally loses to any more specific section match when one also
  // applies (e.g. /provider/services/abc123 matches both "/provider"
  // and "/provider/services" — only the longer, more specific one
  // wins) — exactly the outcome the approved decision calls for,
  // reached generically rather than via a special-cased string.
  const interactiveHrefs = navItems
    .map((item) => item.href)
    .filter((href): href is string => href !== undefined);
  const matchingHrefs = interactiveHrefs.filter(
    (href) => pathname === href || pathname.startsWith(`${href}/`)
  );
  const activeHref =
    matchingHrefs.length > 0
      ? matchingHrefs.reduce((longest, href) => (href.length > longest.length ? href : longest))
      : undefined;

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
          const isInteractive = item.href !== undefined;
          const isActive = isInteractive && item.href === activeHref;

          const itemClassName = clsx(
            "group relative flex items-center gap-3 rounded-xl px-3.5 py-3 text-[0.9rem] font-medium transition-all duration-200",
            isActive
              ? "bg-accent/25 text-primary"
              : isInteractive
                ? "text-foreground/70 hover:bg-background hover:text-foreground"
                : "cursor-not-allowed text-foreground/35 hover:bg-background hover:text-foreground/45"
          );

          const content = (
            <>
              <span className={isActive ? "text-primary" : "text-foreground/30"}>{item.icon}</span>
              {item.label}
              {item.badge !== undefined && item.badge > 0 && (
                <span className="ms-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[0.65rem] font-semibold text-white">
                  {item.badge}
                </span>
              )}
            </>
          );

          return isInteractive ? (
            <Link key={item.label} href={item.href!} aria-current={isActive ? "page" : undefined} className={itemClassName}>
              {content}
            </Link>
          ) : (
            <span key={item.label} aria-disabled className={itemClassName}>
              {content}
            </span>
          );
        })}
      </nav>

      <div className="mt-auto flex items-center gap-3 rounded-xl border border-border p-3">
        <div className="h-10 w-10 shrink-0 rounded-full bg-gradient-to-br from-primary to-secondary" />
        <div className="flex flex-col overflow-hidden">
          <span className="truncate text-sm font-medium text-foreground">حسابي</span>
          <span className="truncate text-xs text-foreground/40">{roleLabel}</span>
        </div>
      </div>
    </motion.aside>
  );
}
