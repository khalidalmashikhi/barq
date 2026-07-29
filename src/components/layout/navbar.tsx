import { Link } from "@/i18n/navigation";
import { getSession } from "@/lib/auth";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { navLinks } from "./nav-links";
import { MobileNav } from "./mobile-nav";
import { LanguageSwitcher } from "./language-switcher";

// Navbar — Phase F.1 (UI/UX Redesign Foundation). Server Component:
// reads session read-only via getSession() to decide Sign In vs. My
// Account, and to tell MobileNav (a small isolated Client Component)
// whether the user is authenticated — no mutation, consistent with
// RBAC helpers being server-only.
//
// NOW ACTUALLY WIRED IN — the prior "Visual Identity Sprint" version
// of this file was built but never rendered by any page
// ("STILL NOT WIRED INTO ANY PAGE", its own comment said). This phase
// renders it at the top of the new public landing page
// (src/app/[locale]/page.tsx), the first page that actually needs a
// marketing-site header. Also fixed: `next/link` → `@/i18n/navigation`'s
// locale-aware Link (the prior version's plain `next/link` usage would
// have dropped the current locale prefix on every click — the same
// class of bug every other navigational component in this app already
// avoids), and hardcoded Arabic strings → next-intl's "landing"
// namespace, for real bilingual parity instead of an Arabic-only nav.

// Phase 2 navbar revision (Brand Identity Reset): logo switched from
// "mark" to "wordmark" at h-10 (was h-7) for real brand presence — the
// icon alone at any size still only reads as an abstract shape; the
// wordmark gives it a legible name. h-10 was chosen because the
// Button component (the row's other content) already renders at
// roughly that height (py-2.5 + text-sm), so the header's own overall
// height is unchanged — the row was already governed by the button,
// not the previous, shorter logo. Added the first real, functional
// LanguageSwitcher — the only previously-existing "language" control
// anywhere (AppTopBar's Globe button) is a decorative placeholder with
// no dropdown/action, not a working switcher.

export async function Navbar() {
  const session = await getSession();
  const t = await getServerTranslator("landing");

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/">
          <Logo variant="wordmark" className="h-10 w-auto object-contain" />
        </Link>

        <nav className="hidden items-center gap-6 lg:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-sm text-sm text-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {t(link.labelKey)}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <LanguageSwitcher />
          {session ? (
            <Link href="/dashboard">
              <Button variant="secondary">{t("nav.myAccount")}</Button>
            </Link>
          ) : (
            <Link href="/login">
              <Button variant="primary">{t("nav.signIn")}</Button>
            </Link>
          )}
        </div>

        <MobileNav isAuthenticated={Boolean(session)} />
      </div>
    </header>
  );
}
