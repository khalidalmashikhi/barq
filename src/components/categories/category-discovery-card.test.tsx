import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Unified Preview System — CategoryDiscoveryCard is the ONE customer-facing
// category card, shared by the homepage discovery grid and the admin category
// preview. interactive=true links to public discovery; interactive=false (admin
// preview of a non-public category) renders the same visual without a link.

vi.mock("@/i18n/navigation", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Link: ({ href, children, className }: any) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const { CategoryDiscoveryCard } = await import("./category-discovery-card");

describe("CategoryDiscoveryCard", () => {
  it("links to public discovery when interactive (default)", () => {
    const html = renderToStaticMarkup(<CategoryDiscoveryCard slug="desert-tours" label="Desert Tours" />);
    expect(html).toContain('href="/services?category=desert-tours"');
    expect(html).toContain("Desert Tours");
  });

  it("renders the same visual without a link when non-interactive (admin preview)", () => {
    const html = renderToStaticMarkup(
      <CategoryDiscoveryCard slug="hidden-cat" label="Hidden Cat" interactive={false} />
    );
    expect(html).not.toContain("href=");
    expect(html).not.toContain("/services?category=");
    expect(html).toContain("Hidden Cat");
  });
});
