"use client";

import { useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { navLinks } from "./nav-links";

// Mobile navigation — Visual Identity Sprint.
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

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="فتح القائمة"
        aria-expanded={open}
        className="rounded-lg p-2 text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
      >
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
          <path d="M3 6h16M3 11h16M3 16h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-background" role="dialog" aria-modal="true">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <Logo className="h-7 w-auto object-contain" />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="إغلاق القائمة"
              className="rounded-lg p-2 text-foreground/70 hover:bg-accent hover:text-foreground"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <nav className="flex flex-col gap-1 px-6 py-6">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-xl px-4 py-3 text-base text-foreground/80 transition-colors hover:bg-accent"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="px-6">
            <Link href={isAuthenticated ? "/dashboard" : "/"} onClick={() => setOpen(false)}>
              <Button variant="primary" className="w-full">
                {isAuthenticated ? "حسابي" : "تسجيل الدخول"}
              </Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
