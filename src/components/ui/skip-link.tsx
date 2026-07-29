import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Skip link — Phase F.4 (Accessibility Audit: "Skip links"). A real,
// standard accessibility gap: nothing in this codebase let a keyboard
// or screen-reader user jump past the repeated Navbar/AppSidebar
// straight to page content. Visually hidden until focused (the
// standard pattern — `sr-only focus:not-sr-only`), targets
// `#main-content`, which this phase adds to AppShell's <main> (every
// authenticated Customer/Provider page) and the public pages already
// wrapped in Navbar/Footer. Rendered once, at the true root layout, so
// it is the very first focusable element on every page.

export async function SkipLink() {
  const t = await getServerTranslator("common");

  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-primary focus:px-5 focus:py-2.5 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-premium-lg"
    >
      {t("skipToContentLabel")}
    </a>
  );
}
