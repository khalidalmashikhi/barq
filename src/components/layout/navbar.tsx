import Link from "next/link";
import { getSession } from "@/lib/auth";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { navLinks } from "./nav-links";
import { MobileNav } from "./mobile-nav";

// Navbar — Visual Identity Sprint. Server Component: reads session
// read-only via getSession() to decide Login vs. Profile, and to tell
// MobileNav (a small isolated Client Component) whether the user is
// authenticated — no mutation, consistent with RBAC helpers being
// server-only.
//
// STILL NOT WIRED INTO ANY PAGE — see the original scope note carried
// over: most nav links point to routes that don't exist yet, and the
// marketing-homepage routing question remains unresolved.

export async function Navbar() {
  const session = await getSession();

  return (
    <header className="border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/">
          <Logo className="h-7 w-auto object-contain" />
        </Link>

        <nav className="hidden items-center gap-6 lg:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-foreground/70 transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <span className="text-sm text-foreground/50">EN / ع</span>
          {session ? (
            <Link href="/dashboard">
              <Button variant="secondary">حسابي</Button>
            </Link>
          ) : (
            <Link href="/">
              <Button variant="primary">تسجيل الدخول</Button>
            </Link>
          )}
        </div>

        <MobileNav isAuthenticated={Boolean(session)} />
      </div>
    </header>
  );
}
