import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

// Provider Home QuickActions — must be REAL shortcuts to existing provider routes, trimmed
// and biased toward non-duplicate destinations (create a service, preview the public
// profile). No jsdom in the repo, so we render the server component to static markup and
// assert on it.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: vi.fn().mockResolvedValue((k: string) => k),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const { QuickActions } = await import("./quick-actions");

describe("Provider QuickActions", () => {
  it("renders real links to existing provider routes (create service, bookings, availability, preview)", async () => {
    const html = renderToStaticMarkup(await QuickActions());
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(["/provider/services/new", "/provider/bookings", "/provider/availability", "/provider/preview"]);
  });

  it("contains no disabled / non-interactive tiles", async () => {
    const html = renderToStaticMarkup(await QuickActions());
    expect(html).not.toMatch(/disabled|aria-disabled/);
  });
});
