import { describe, it, expect } from "vitest";
import { toSafeJsonLdString } from "./safe-json-ld";

// Production Blocker fix — regression tests proving the exact stored-XSS
// payload class this function exists to neutralize can no longer break
// out of a <script type="application/ld+json"> element.

describe("toSafeJsonLdString", () => {
  it("escapes a literal </script> sequence so it cannot terminate the surrounding script tag", () => {
    const malicious = { name: '</script><script>alert(1)</script>' };
    const result = toSafeJsonLdString(malicious);

    expect(result).not.toContain("</script>");
    expect(result).toContain("\\u003c/script>");
  });

  it("escapes every '<' character, not just the </script> sequence", () => {
    const result = toSafeJsonLdString({ name: "<img onerror=alert(1)>" });
    expect(result.replace(/\\u003c/g, "")).not.toContain("<");
    expect(result).toContain("\\u003cimg onerror=alert(1)>");
  });

  it("still produces valid, round-trippable JSON for ordinary content", () => {
    const data = { "@type": "Product", name: "Desert Safari", price: "25.00" };
    const result = toSafeJsonLdString(data);

    expect(JSON.parse(result)).toEqual(data);
  });

  it("leaves content with no '<' character byte-identical to plain JSON.stringify", () => {
    const data = { "@type": "BreadcrumbList", name: "Stargazing Experience" };
    expect(toSafeJsonLdString(data)).toBe(JSON.stringify(data));
  });
});
