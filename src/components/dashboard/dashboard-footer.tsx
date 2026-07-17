import { Instagram, Twitter, Facebook } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Links point nowhere real yet — no Support/Terms/Privacy pages exist
// in this project. Rendered as spans, not <Link>, to avoid 404s while
// still showing the intended footer structure.

export async function DashboardFooter() {
  const t = await getServerTranslator("dashboard");
  const links = [t("supportLabel"), t("footerTermsLabel"), t("footerPrivacyLabel")];

  return (
    <footer className="mt-4 border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-8 py-10 text-center sm:flex-row sm:justify-between sm:text-start">
        <Logo className="h-8 max-w-[90px] opacity-70" />

        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {links.map((link) => (
            <span key={link} className="cursor-default text-sm text-foreground/50">
              {link}
            </span>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Instagram size={16} strokeWidth={1.75} className="text-foreground/40" />
          <Twitter size={16} strokeWidth={1.75} className="text-foreground/40" />
          <Facebook size={16} strokeWidth={1.75} className="text-foreground/40" />
        </div>
      </div>
      <p className="border-t border-border py-4 text-center text-xs text-foreground/30">
        {t("copyrightText", { year: new Date().getFullYear() })}
      </p>
    </footer>
  );
}
