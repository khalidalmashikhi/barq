import { describe, it, expect, vi, afterEach } from "vitest";

// AUTH-NAV-1 — authenticated customers/providers/staff keep the public Home;
// ONLY an active Admin is redirected off Home (Gate A, backoffice-only). The page
// branches on exactly one authoritative primitive: isActiveAdminSession(). Anon,
// customer, provider, and staff all resolve to `false` and therefore all render
// Home — there is deliberately no other role branch on this route.

vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));

// Real redirect() halts execution by throwing; mirror that so nothing runs after.
const redirectMock = vi.fn();
redirectMock.mockImplementation(() => {
  throw new Error("REDIRECT");
});
vi.mock("@/i18n/navigation", () => ({ redirect: (...a: unknown[]) => redirectMock(...a) }));

const isActiveAdminSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({ isActiveAdminSession: () => isActiveAdminSessionMock() }));

const getHomeDiscoveryMock = vi.fn();
getHomeDiscoveryMock.mockResolvedValue({
  governorates: [],
  selectedGovernorate: null,
  groups: [],
  recommended: [],
  destinations: [],
});
vi.mock("@/lib/discovery/get-home-discovery", () => ({ getHomeDiscovery: (...a: unknown[]) => getHomeDiscoveryMock(...a) }));

// Child server components are only referenced as element types here (never
// executed), but stub them so importing the page never pulls their dependency
// chains (auth server, prisma) into this focused unit test.
vi.mock("@/lib/i18n/get-server-translator", () => ({ getServerTranslator: async () => (k: string) => k }));
vi.mock("@/lib/i18n/metadata", () => ({ buildLocalizedMetadata: () => ({}) }));
vi.mock("@/components/layout/navbar", () => ({ Navbar: () => null }));
vi.mock("@/components/layout/footer", () => ({ Footer: () => null }));
vi.mock("@/components/home/home-hero", () => ({ HomeHero: () => null }));
vi.mock("@/components/home/discovery-grid", () => ({ DiscoveryGrid: () => null }));
vi.mock("@/components/home/selected-for-you", () => ({ SelectedForYou: () => null }));
vi.mock("@/components/home/explore-oman", () => ({ ExploreOman: () => null }));

const { default: HomePage } = await import("./page");

afterEach(() => {
  redirectMock.mockClear();
  isActiveAdminSessionMock.mockReset();
  getHomeDiscoveryMock.mockClear();
});

async function renderHome() {
  return HomePage({ searchParams: Promise.resolve({}) });
}

describe("HomePage — authenticated-Home routing (AUTH-NAV-1)", () => {
  it("anonymous visitor → Home renders (no redirect)", async () => {
    isActiveAdminSessionMock.mockResolvedValue(false);
    const el = await renderHome();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(getHomeDiscoveryMock).toHaveBeenCalledWith({ regionCode: null, locale: "en" });
    expect(el).toBeTruthy();
  });

  it("authenticated customer → Home renders (NOT redirected to /dashboard)", async () => {
    isActiveAdminSessionMock.mockResolvedValue(false);
    await renderHome();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(getHomeDiscoveryMock).toHaveBeenCalled();
  });

  it("provider → Home renders (NOT auto-redirected to /provider)", async () => {
    isActiveAdminSessionMock.mockResolvedValue(false);
    await renderHome();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("staff → Home renders (no security invariant forbids it)", async () => {
    isActiveAdminSessionMock.mockResolvedValue(false);
    await renderHome();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("active Admin → redirected to /admin (Gate A preserved), Home never built", async () => {
    isActiveAdminSessionMock.mockResolvedValue(true);
    await expect(renderHome()).rejects.toThrow("REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith({ href: "/admin", locale: "en" });
    expect(getHomeDiscoveryMock).not.toHaveBeenCalled();
  });
});
