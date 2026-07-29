import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";

// BARQ — Scenario B1: Authenticated Reads (dashboard / bookings /
// provider dashboard). Targets the isolated STAGING environment only.
// See docs/11-release/LOAD_TEST_PLAN.md §5 (B1).
//
// SESSION POOL: reads scripts/load-test/.session-pool.json — a
// gitignored, locally-captured file of Better Auth session cookies
// from a small, fixed pool of staging test accounts, each logged in
// exactly once, by a human, through the real OTP flow (LOAD_TEST_PLAN.md
// §2). This script never logs in and never triggers an OTP send — it
// only reuses already-authenticated sessions. If every request in a
// run starts failing with a redirect-to-login, the pool has expired;
// refresh it out-of-band before re-running (see that document).

const BASE_URL = __ENV.STAGING_URL || "https://staging.example.invalid";
const LOCALE = __ENV.LOCALE || "en";

const sessionPool = new SharedArray("sessions", function () {
  // Expected shape: [{ "cookieName": "better-auth.session_token", "cookieValue": "..." }, ...]
  // Populate this file locally per LOAD_TEST_PLAN.md §2 — never commit it.
  return JSON.parse(open("./.session-pool.json"));
});

export const options = {
  scenarios: {
    authenticated_reads: {
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

function sessionFor(vu) {
  return sessionPool[vu % sessionPool.length];
}

export default function () {
  const session = sessionFor(__VU);
  const jar = http.cookieJar();
  jar.set(BASE_URL, session.cookieName, session.cookieValue);

  const dashboard = http.get(`${BASE_URL}/${LOCALE}/dashboard`);
  check(dashboard, {
    "dashboard 200": (r) => r.status === 200,
    "dashboard not redirected to login": (r) => !r.url.includes("/login"),
  });

  const bookings = http.get(`${BASE_URL}/${LOCALE}/bookings`);
  check(bookings, { "bookings 200": (r) => r.status === 200 });

  sleep(1 + Math.random() * 2);
}
