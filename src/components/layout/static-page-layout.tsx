import type { ReactNode } from "react";
import { Navbar } from "./navbar";
import { Footer } from "./footer";

// Static page layout — Phase F.4 (Help Center / About / Legal pages).
// One reusable shell (Navbar + heading + Footer) for every new
// informational public page this phase adds, instead of re-copying
// the same `<div><Navbar/><main>...</main><Footer/></div>` structure
// across 10 separate files — directly serves this phase's own
// "reusable layouts" / "avoid duplicate components" goals.

type StaticPageLayoutProps = {
  title: string;
  subtitle?: string;
  maxWidthClassName?: string;
  children: ReactNode;
};

export function StaticPageLayout({ title, subtitle, maxWidthClassName = "max-w-3xl", children }: StaticPageLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main id="main-content" className={`mx-auto flex w-full ${maxWidthClassName} flex-1 flex-col gap-10 px-6 py-16`}>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{title}</h1>
          {subtitle && <p className="mt-3 max-w-2xl text-foreground/60">{subtitle}</p>}
        </div>
        {children}
      </main>
      <Footer />
    </div>
  );
}
