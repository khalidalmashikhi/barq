import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { navLinks } from "./nav-links";

// Footer — Visual Identity Sprint. Same scope caveat as Navbar: most
// linked routes don't exist yet. Not wired into any page yet either —
// same unresolved marketing-homepage routing question.
//
// Deliberately minimal: no fabricated contact details, social links, or
// company information not established anywhere in this project's real
// documentation — only what's genuinely known (the product name, the
// nav structure already defined once in nav-links.ts).

export function Footer() {
  return (
    <footer className="border-t border-border bg-background px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 text-center">
        <Logo className="h-7 w-auto object-contain" />

        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-foreground/60 transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <p className="text-xs text-foreground/40">
          © {new Date().getFullYear()} BARQ
        </p>
      </div>
    </footer>
  );
}
