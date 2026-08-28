import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

// Customer Experience Polish — QuickActions must be REAL shortcuts (working links to
// existing customer routes), never the former inert, handler-less tiles. The repo has no
// testing-library/jsdom, so we render the server component's output to static markup
// (string) and assert on it.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: vi.fn().mockResolvedValue((k: string) => k),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/ui/card", () => ({ Card: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

const { QuickActions } = await import("./quick-actions");

describe("QuickActions", () => {
  it("renders four tiles, each a real Link to an existing customer route", async () => {
    const html = renderToStaticMarkup(await QuickActions());
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(["/services", "/bookings", "/payments", "/dashboard/settings"]);
  });

  it("contains no disabled / non-interactive controls", async () => {
    const html = renderToStaticMarkup(await QuickActions());
    expect(html).not.toMatch(/disabled|aria-disabled/);
  });
});
