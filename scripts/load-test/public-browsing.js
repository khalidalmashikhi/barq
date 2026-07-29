import http from "k6/http";
import { check, sleep } from "k6";

// BARQ — Scenario A: Public Browsing (read-only).
// Targets the isolated STAGING environment only — never production.
// See docs/11-release/LOAD_TEST_PLAN.md §4 for the full plan this
// script implements. Do not run the 300/500 VU stages without
// explicit owner approval (see that document's own gating language).

const BASE_URL = __ENV.STAGING_URL || "https://staging.example.invalid";
const LOCALE = __ENV.LOCALE || "en";

export const options = {
  scenarios: {
    public_browsing: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 25 },
        { duration: "2m", target: 25 },
        { duration: "30s", target: 0 },
        { duration: "1m", target: 100 },
        { duration: "3m", target: 100 },
        { duration: "1m", target: 0 },
        { duration: "2m", target: 300 },
        { duration: "5m", target: 300 },
        { duration: "1m", target: 0 },
        { duration: "2m", target: 500 },
        { duration: "5m", target: 500 },
        { duration: "1m", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(50)<400", "p(95)<1200", "p(99)<2500"],
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"],
  },
};

// Populated once per test run from a real staging services listing —
// replace with real staging service/provider IDs before running (see
// LOAD_TEST_PLAN.md §2 — no live ID is fabricated here).
const SAMPLE_SERVICE_IDS = (__ENV.SAMPLE_SERVICE_IDS || "").split(",").filter(Boolean);
const SAMPLE_PROVIDER_SLUGS = (__ENV.SAMPLE_PROVIDER_SLUGS || "").split(",").filter(Boolean);

function pick(list) {
  return list.length > 0 ? list[Math.floor(Math.random() * list.length)] : null;
}

export default function () {
  const homepage = http.get(`${BASE_URL}/${LOCALE}`);
  check(homepage, { "homepage 200": (r) => r.status === 200 });

  const listing = http.get(`${BASE_URL}/${LOCALE}/services`);
  check(listing, { "services listing 200": (r) => r.status === 200 });

  const serviceId = pick(SAMPLE_SERVICE_IDS);
  if (serviceId) {
    const detail = http.get(`${BASE_URL}/${LOCALE}/services/${serviceId}`);
    check(detail, { "service detail 200": (r) => r.status === 200 });
  }

  const providerSlug = pick(SAMPLE_PROVIDER_SLUGS);
  if (providerSlug) {
    const provider = http.get(`${BASE_URL}/${LOCALE}/providers/${providerSlug}`);
    check(provider, { "provider detail 200": (r) => r.status === 200 });
  }

  // Sitemap only ~1-in-20 iterations — larger payload, not the core
  // per-iteration path (see LOAD_TEST_PLAN.md §4).
  if (Math.random() < 0.05) {
    const sitemap = http.get(`${BASE_URL}/sitemap.xml`);
    check(sitemap, { "sitemap 200": (r) => r.status === 200 });
  }

  const health = http.get(`${BASE_URL}/api/health`);
  check(health, { "health reachable": (r) => r.status === 200 || r.status === 503 });

  sleep(1 + Math.random() * 2);
}
