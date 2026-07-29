"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/ui/logo";
import { clsx } from "@/components/ui/clsx";
import type { AppNavItem } from "./app-sidebar";

// Mobile navigation for the authenticated app shell — Phase F.3
// (Provider Navigation, goal 3: "Mobile navigation"). Fixes a real,
// pre-existing gap found while reviewing provider navigation:
// AppSidebar is `hidden md:flex` with no mobile equivalent at all — a
// Provider (or Customer, since AppShell is shared) on a phone had
// zero navigation below md, only whatever the current page's own
// content happened to link to. Mirrors the public MobileNav's
// drawer pattern (src/components/layout/mobile-nav.tsx), adapted for
// AppNavItem (role-supplied items with hrefs already locale-resolved
// by the caller, matching AppSidebar's own contract exactly) instead
// of the public nav's static link list.

type AppMobileNavProps = {
  navItems: AppNavItem[];
  roleLabel: string;
};

export function AppMobileNav({ navItems, roleLabel }: AppMobileNavProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const t = useTranslations("common");
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const triggerButton = menuButtonRef.current;
    return () => {
      triggerButton?.focus();
    };
  }, [open]);

  const interactiveHrefs = navItems.map((item) => item.href).filter((href): href is string => href !== undefined);
  const matchingHrefs = interactiveHrefs.filter((href) => pathname === href || pathname.startsWith(`${href}/`));
  const activeHref =
    matchingHrefs.length > 0 ? matchingHrefs.reduce((longest, href) => (href.length > longest.length ? href : longest)) : undefined;

  return (
    <div className="md:hidden">
      <button
        ref={menuButtonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("openMenuAriaLabel")}
        aria-expanded={open}
        className="rounded-lg p-2 text-foreground/70 transition-colors hover:bg-accent/20 hover:text-foreground"
      >
        <Menu size={22} strokeWidth={1.75} aria-hidden />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <Logo variant="mark" className="h-7 w-auto object-contain" />
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("closeMenuAriaLabel")}
              className="rounded-lg p-2 text-foreground/70 hover:bg-accent hover:text-foreground"
            >
              <X size={20} strokeWidth={1.75} aria-hidden />
            </button>
          </div>

          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-6 py-6">
            {navItems.map((item) => {
              const isInteractive = item.href !== undefined;
              const isActive = isInteractive && item.href === activeHref;
              const content = (
                <>
                  <span className={isActive ? "text-primary" : "text-foreground/40"}>{item.icon}</span>
                  {item.label}
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="ms-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[0.65rem] font-semibold text-white">
                      {item.badge}
                    </span>
                  )}
                  {!isInteractive && item.disabledHint && (
                    <span className="ms-auto rounded-full bg-accent/15 px-2 py-0.5 text-[0.65rem] font-medium text-foreground/40">
                      {item.disabledHint}
                    </span>
                  )}
                </>
              );
              const itemClassName = clsx(
                "flex items-center gap-3 rounded-xl px-4 py-3 text-base font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                isActive
                  ? "bg-accent/25 text-primary"
                  : isInteractive
                    ? "text-foreground/80 hover:bg-accent"
                    : "cursor-not-allowed text-foreground/35"
              );

              return isInteractive ? (
                <Link key={item.label} href={item.href!} onClick={() => setOpen(false)} aria-current={isActive ? "page" : undefined} className={itemClassName}>
                  {content}
                </Link>
              ) : (
                <span
                  key={item.label}
                  aria-disabled="true"
                  aria-label={item.disabledHint ? `${item.label} — ${item.disabledHint}` : undefined}
                  className={itemClassName}
                >
                  {content}
                </span>
              );
            })}
          </nav>

          <div className="border-t border-border px-6 py-4 text-xs text-foreground/40">{roleLabel}</div>
        </div>
      )}
    </div>
  );
}
