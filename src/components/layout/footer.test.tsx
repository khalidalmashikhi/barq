import { describe, it, expect, vi } from "vitest";

// AUTH-NAV-2/3 — the Footer separates role entry: a restrained "For partners"
// column (Join → existing /provider-application, Provider login → shared /login)
// and a subtle "Admin & Staff Portal" utility link (→ shared /login). The
// redundant customer "Sign In" is gone (it lives in the Header), and no dead Home
// anchors (#how-it-works/#destinations) survive.

vi.mock("@/lib/i18n/get-server-translator", () => ({ getServerTranslator: async () => (k: string) => k }));
vi.mock("@/i18n/navigation", () => ({ Link: (props: { href: string; children: unknown }) => props }));
vi.mock("@/components/ui/logo", () => ({ Logo: () => null }));

const { Footer } = await import("./footer");

type AnyElement = { type: unknown; props: Record<string, unknown> };
function collectHrefs(element: unknown, acc: string[] = []): string[] {
  if (!element || typeof element !== "object") return acc;
  if (Array.isArray(element)) {
    for (const child of element) collectHrefs(child, acc);
    return acc;
  }
  const el = element as AnyElement;
  if (typeof el.props?.href === "string") acc.push(el.props.href as string);
  if (el.props?.children !== undefined) collectHrefs(el.props.children, acc);
  return acc;
}
function collectStrings(element: unknown, acc: string[] = []): string[] {
  if (typeof element === "string") return (acc.push(element), acc);
  if (!element || typeof element !== "object") return acc;
  if (Array.isArray(element)) {
    for (const child of element) collectStrings(child, acc);
    return acc;
  }
  collectStrings((element as AnyElement).props?.children, acc);
  return acc;
}

describe("Footer — role entry UX (AUTH-NAV-2/3)", () => {
  it("'Join as a provider' points to the existing /provider-application onboarding", async () => {
    expect(collectHrefs(await Footer())).toContain("/provider-application");
  });

  it("'Provider login' points to the shared /login (no parallel auth)", async () => {
    const hrefs = collectHrefs(await Footer());
    expect(hrefs.filter((h) => h === "/login").length).toBeGreaterThanOrEqual(1);
  });

  it("'Admin & Staff Portal' is an entry to the shared /login (labelled distinctly)", async () => {
    const el = await Footer();
    expect(collectStrings(el)).toContain("footer.adminStaffPortal");
    expect(collectHrefs(el)).toContain("/login");
  });

  it("does NOT repeat a generic customer Sign In (that lives in the Header)", async () => {
    expect(collectStrings(await Footer())).not.toContain("nav.signIn");
  });

  it("preserves the real Browse + Company destinations", async () => {
    const hrefs = collectHrefs(await Footer());
    for (const h of ["/services", "/about", "/help", "/contact", "/terms", "/privacy", "/cookies"]) {
      expect(hrefs).toContain(h);
    }
  });

  it("contains no dead Home anchors (#how-it-works / #destinations)", async () => {
    const hrefs = collectHrefs(await Footer());
    expect(hrefs.some((h) => h.startsWith("#"))).toBe(false);
  });
});
