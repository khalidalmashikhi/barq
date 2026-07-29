import { describe, it, expect, vi, afterEach } from "vitest";

// Phase D.3 (Production Hardening) — regression test for the security
// headers in next.config.ts: verifies the always-on headers are
// present regardless of environment, and that the
// Content-Security-Policy is emitted ONLY when NODE_ENV=production
// (dev mode's own Fast Refresh/HMR needs capabilities this CSP doesn't
// grant — see next.config.ts's own comment for the full reasoning).
//
// vi.stubEnv (not a direct `process.env.NODE_ENV = ...` assignment) —
// @types/node types NODE_ENV as a readonly property of ProcessEnv, so
// a direct assignment fails `tsc --noEmit`; vi.stubEnv is Vitest's own
// supported mechanism for exactly this, and vi.unstubAllEnvs() in
// afterEach restores the real value after every test.

afterEach(() => {
  vi.unstubAllEnvs();
});

async function getHeaderRules() {
  const { default: config } = await import("./next.config");
  const rules = await config.headers?.();
  return rules?.[0]?.headers ?? [];
}

function findHeader(headers: { key: string; value: string }[], key: string) {
  return headers.find((h) => h.key === key);
}

describe("next.config.ts headers()", () => {
  it("always includes the baseline security headers", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const headers = await getHeaderRules();

    expect(findHeader(headers, "X-Content-Type-Options")?.value).toBe("nosniff");
    expect(findHeader(headers, "X-Frame-Options")?.value).toBe("DENY");
    expect(findHeader(headers, "Referrer-Policy")?.value).toBe("strict-origin-when-cross-origin");
    expect(findHeader(headers, "Permissions-Policy")).toBeDefined();
  });

  it("always includes Strict-Transport-Security, even outside production (harmless over HTTP)", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const headers = await getHeaderRules();

    expect(findHeader(headers, "Strict-Transport-Security")?.value).toContain("max-age=");
  });

  it("omits Content-Security-Policy when NODE_ENV is not production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const headers = await getHeaderRules();

    expect(findHeader(headers, "Content-Security-Policy")).toBeUndefined();
  });

  it("includes a restrictive Content-Security-Policy when NODE_ENV=production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const headers = await getHeaderRules();

    const csp = findHeader(headers, "Content-Security-Policy");
    expect(csp).toBeDefined();
    expect(csp!.value).toContain("default-src 'self'");
    expect(csp!.value).toContain("frame-ancestors 'none'");
    expect(csp!.value).toContain("object-src 'none'");
  });
});
