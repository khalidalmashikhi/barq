// Deployment verification script — Go-Live Preparation phase.
//
// WHY THIS EXISTS: PRODUCTION_RUNBOOK.md's own health/sitemap/robots
// verification steps were previously three separate manual curl
// commands run by hand after every deploy. This is that same
// verification, scripted — a repository-owned sanity check against a
// real deployed URL, not deployment infrastructure (no hosting/CI
// integration is added here; this is meant to be run manually, or
// wired into an existing CI/CD pipeline's own post-deploy step by
// whoever owns that pipeline, later).
//
// Uses Node's built-in fetch (Node 20+, this project's own declared
// engines.node minimum) — no new HTTP client dependency introduced.
//
// DELIBERATELY READ-ONLY: every check here is a GET against a public,
// unauthenticated endpoint. This script never authenticates, never
// mutates, and never accepts credentials as arguments — it has nothing
// to leak and cannot itself become an attack surface.
//
// USAGE: npx tsx scripts/verify-deployment.ts https://barq.example.com

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

async function checkHealth(baseUrl: string): Promise<CheckResult> {
  const url = `${baseUrl}/api/health`;
  try {
    const response = await fetch(url);
    const body = (await response.json()) as Record<string, unknown>;

    const fields = ["status", "database", "otpProvider", "paymentProvider", "environment"] as const;
    const summary = fields.map((field) => `${field}=${String(body[field])}`).join(" ");

    if (response.status !== 200 || body.status !== "ok") {
      return { name: "GET /api/health", ok: false, detail: `HTTP ${response.status} — ${summary}` };
    }
    return { name: "GET /api/health", ok: true, detail: summary };
  } catch (error) {
    return { name: "GET /api/health", ok: false, detail: `request failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function checkRobots(baseUrl: string): Promise<CheckResult> {
  const url = `${baseUrl}/robots.txt`;
  try {
    const response = await fetch(url);
    const text = await response.text();
    const hasSitemapDirective = /^Sitemap:/im.test(text);

    if (response.status !== 200) {
      return { name: "GET /robots.txt", ok: false, detail: `HTTP ${response.status}` };
    }
    if (!hasSitemapDirective) {
      return { name: "GET /robots.txt", ok: false, detail: "200 OK, but no Sitemap: directive found" };
    }
    return { name: "GET /robots.txt", ok: true, detail: "200 OK, Sitemap: directive present" };
  } catch (error) {
    return { name: "GET /robots.txt", ok: false, detail: `request failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function checkSitemap(baseUrl: string): Promise<CheckResult> {
  const url = `${baseUrl}/sitemap.xml`;
  try {
    const response = await fetch(url);
    const text = await response.text();
    const urlCount = (text.match(/<loc>/g) ?? []).length;

    if (response.status !== 200) {
      return { name: "GET /sitemap.xml", ok: false, detail: `HTTP ${response.status}` };
    }
    if (urlCount === 0) {
      return { name: "GET /sitemap.xml", ok: false, detail: "200 OK, but zero <loc> entries found" };
    }
    return { name: "GET /sitemap.xml", ok: true, detail: `200 OK, ${urlCount} entries` };
  } catch (error) {
    return { name: "GET /sitemap.xml", ok: false, detail: `request failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function main() {
  const baseUrlArg = process.argv[2];

  if (!baseUrlArg) {
    console.error("Usage: npx tsx scripts/verify-deployment.ts <base-url>");
    console.error("Example: npx tsx scripts/verify-deployment.ts https://barq.example.com");
    process.exitCode = 1;
    return;
  }

  const baseUrl = baseUrlArg.replace(/\/+$/, "");

  console.log(`Verifying deployment at ${baseUrl} ...\n`);

  const results = await Promise.all([checkHealth(baseUrl), checkRobots(baseUrl), checkSitemap(baseUrl)]);

  for (const result of results) {
    console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name} — ${result.detail}`);
  }

  const allPassed = results.every((result) => result.ok);
  console.log(`\n${allPassed ? "All checks passed." : "One or more checks FAILED — do not consider this deploy complete."}`);

  process.exitCode = allPassed ? 0 : 1;
}

main().catch((error) => {
  console.error("verify-deployment failed unexpectedly:", error);
  process.exitCode = 1;
});
