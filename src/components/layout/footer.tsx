import { Link } from "@/i18n/navigation";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { Logo } from "@/components/ui/logo";
import { navLinks } from "./nav-links";

// Footer — Phase F.1 (UI/UX Redesign Foundation). Now actually wired
// into the new public landing page (see navbar.tsx's own comment for
// the full "built but never rendered" history) with real i18n
// ("landing" namespace) instead of hardcoded Arabic, and the
// locale-aware Link from "@/i18n/navigation" instead of plain
// "next/link" (which would drop the current locale prefix).
//
// Phase F.4 (Trust & Quality, goal 5/7): "companyLinks" below route to
// real pages built this phase (About/Help/Contact/Terms/Privacy/
// Cookies) — the "aboutLink"/"contactLink" translation keys already
// existed in landing.json since Phase F.1 but were never rendered
// (dead keys, no matching page existed yet); this is the first phase
// where that gap is closed with real destinations, not a new
// fabrication.

const companyLinks = [
  { labelKey: "footer.aboutLink", href: "/about" },
  { labelKey: "footer.helpLink", href: "/help" },
  { labelKey: "footer.contactLink", href: "/contact" },
  { labelKey: "footer.termsLink", href: "/terms" },
  { labelKey: "footer.privacyLink", href: "/privacy" },
  { labelKey: "footer.cookiesLink", href: "/cookies" },
] as const;

export async function Footer() {
  const t = await getServerTranslator("landing");

  return (
    <footer className="border-t border-border bg-background px-6 py-12 pb-28 lg:pb-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
          <div className="flex flex-col items-center gap-3 text-center sm:items-start sm:text-start">
            <Logo variant="wordmark" className="h-8 w-auto object-contain" />
            <p className="max-w-xs text-sm text-foreground/50">{t("footer.tagline")}</p>
          </div>

          <div className="flex flex-col items-center gap-3 text-center sm:items-start sm:text-start">
            <span className="text-xs font-semibold uppercase tracking-wide text-foreground/40">{t("footer.browseHeading")}</span>
            <nav className="flex flex-col items-center gap-2 sm:items-start">
              {navLinks.map((link) => {
                const className =
                  "rounded-sm text-sm text-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
                // In-page anchors (#...) stay raw <a>; real routes use the
                // locale-aware Link so the locale prefix is preserved
                // (a raw <a href="/services"> dropped it — i18n stabilization).
                return link.href.startsWith("#") ? (
                  <a key={link.href} href={link.href} className={className}>
                    {t(link.labelKey)}
                  </a>
                ) : (
                  <Link key={link.href} href={link.href} className={className}>
                    {t(link.labelKey)}
                  </Link>
                );
              })}
              <Link href="/login" className="rounded-sm text-sm text-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                {t("nav.signIn")}
              </Link>
            </nav>
          </div>

          <div className="flex flex-col items-center gap-3 text-center sm:items-start sm:text-start">
            <span className="text-xs font-semibold uppercase tracking-wide text-foreground/40">{t("footer.companyHeading")}</span>
            <nav className="flex flex-col items-center gap-2 sm:items-start">
              {companyLinks.map((link) => (
                <Link key={link.href} href={link.href} className="rounded-sm text-sm text-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                  {t(link.labelKey)}
                </Link>
              ))}
            </nav>
          </div>
        </div>

        <p className="text-center text-xs text-foreground/40 sm:text-start">
          © {new Date().getFullYear()} BARQ — {t("footer.rightsReserved")}
        </p>
      </div>
    </footer>
  );
}
