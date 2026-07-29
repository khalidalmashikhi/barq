"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { X, Menu } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { navLinks } from "./nav-links";
import { LanguageSwitcher } from "./language-switcher";

// Mobile navigation — Phase F.1 (UI/UX Redesign Foundation). Now
// actually wired in (see navbar.tsx's own comment) with real i18n and
// locale-aware Link — same fixes as Navbar/Footer.
//
// Isolated as its own Client Component specifically so the parent
// Navbar can remain a Server Component (it reads the session via
// getSession() — read-only, server-side, per RBAC's own server-only
// convention). Only the toggle state itself needs the client.
//
// `isAuthenticated` is passed in as a plain boolean from the server
// parent — this component never calls getSession() or any auth
// function itself, avoiding a second, redundant session check.

type MobileNavProps = {
  isAuthenticated: boolean;
};

export function MobileNav({ isAuthenticated }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const t = useTranslations("landing");

  useEffect(() => {
    setMounted(true);
  }, []);

  const drawer = (
    <div className="fixed inset-0 z-50 bg-background" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <Logo variant="mark" className="h-7 w-auto object-contain" />
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t("nav.closeMenu")}
          className="rounded-lg p-2 text-foreground/70 hover:bg-accent hover:text-foreground"
        >
          <X size={20} strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      <nav className="flex flex-col gap-1 px-6 py-6">
        {navLinks.map((link) => (
          <a
            key={link.href}
            href={link.href}
            onClick={() => setOpen(false)}
            className="rounded-xl px-4 py-3 text-base text-foreground/80 transition-colors hover:bg-accent"
          >
            {t(link.labelKey)}
          </a>
        ))}
      </nav>

      <div className="flex px-6 pb-6">
        <LanguageSwitcher onSelect={() => setOpen(false)} />
      </div>

      <div className="px-6">
        <Link href={isAuthenticated ? "/dashboard" : "/login"} onClick={() => setOpen(false)}>
          <Button variant="primary" className="w-full">
            {isAuthenticated ? t("nav.myAccount") : t("nav.signIn")}
          </Button>
        </Link>
      </div>
    </div>
  );

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("nav.openMenu")}
        aria-expanded={open}
        className="rounded-lg p-2 text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
      >
        <Menu size={22} strokeWidth={1.75} aria-hidden />
      </button>

      {/* Portalled to document.body: the parent <header> uses backdrop-blur-md,
          and a computed backdrop-filter establishes a containing block for
          fixed-position descendants (Chromium). Left in place, "fixed inset-0"
          would resolve against the header's own ~73px box instead of the
          viewport, leaving everything below the header row transparent. */}
      {open && mounted && createPortal(drawer, document.body)}
    </div>
  );
}
