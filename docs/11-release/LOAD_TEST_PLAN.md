# BARQ — Controlled Load-Test Plan (k6)

Produced by the Code Freeze / Operational Validation phase. **Targets the isolated staging environment only** ([`STAGING_DEPLOYMENT_CHECKLIST.md`](STAGING_DEPLOYMENT_CHECKLIST.md)) — never production. **No test in this plan has been executed.** k6 is not currently installed or referenced anywhere in this repository (confirmed via `package.json` and a repo-wide search) — it is a standalone binary (`brew install k6` / `choco install k6` / official installer), not an npm dependency, and is the tool this plan names per the mission's own "k6 or the repository's existing preferred tooling" instruction, since no existing load-test tooling exists to prefer.

**The 300 VU and 500 VU stages, and the authenticated booking-creation (write) scenario at any VU count, must not be run without explicit owner approval** — per the mission's own "do not execute destructive or expensive tests without approval" instruction. The 25 and 100 VU public-browsing (read-only) stages are low-risk and can reasonably be treated as the initial, approval-gated-but-lower-stakes run.

---

## 1. Why Public Browsing and Authenticated Booking Are Scripted Differently

**Public browsing** (homepage, `/services`, `/services/[id]`, `/providers/[idOrSlug]`, `/sitemap.xml`, `/api/health`) is plain server-rendered GET traffic — a standard k6 HTTP script handles this directly, no special handling needed.

**Authenticated booking** is not a REST endpoint — `createBooking` (`src/lib/booking/create-booking.ts`) is a Next.js Server Action (`"use server"`), invoked over Next.js's own internal action-invocation wire protocol (a POST to the originating page URL carrying a `Next-Action` header and an RSC-encoded body), not a documented, stable JSON API. Reverse-engineering that wire format for a raw k6 HTTP script would be brittle across Next.js/dependency version bumps and is not a foundation to build a repeatable load test on. This plan instead uses **k6's browser module** (real, headless-Chromium-driven interaction) for the booking-creation write path — it drives the actual rendered form exactly as a real user's browser would, so it stays correct regardless of Next.js's internal protocol. Authenticated *read* pages (`/dashboard`, `/bookings`, `/provider`) have no such constraint — they're server-rendered GETs like public pages, just with a session cookie attached, so they're scripted with plain k6 HTTP.

## 2. Avoiding Mass Real OTP Sending

The mission explicitly requires avoiding mass real OTP sends. Design:

1. **One-time, out-of-band, human-performed bootstrap** (not part of any k6 script, not automated, not repeated per test run): a small, fixed pool of **10 pre-created staging Customer test accounts** each complete one real login through the actual `/login` OTP flow, one single time, by a human. This is 10 real OTP sends total, ever — not per load-test run, not per virtual user.
2. Each resulting Better Auth session cookie is captured (browser DevTools → Application → Cookies, or via `document.cookie` in the console) and saved to a local, **gitignored** file (`scripts/load-test/.session-pool.json` — never committed; add to `.gitignore` if it isn't already covered by an existing `*.local.json`/env-file pattern before first use).
3. Every k6 virtual user in the authenticated scenarios picks one of the 10 pooled sessions (`__VU % 10`) — reused across all 25/100/300/500 VUs, never triggering a new login or OTP send regardless of scale.
4. **Session expiry**: Better Auth sessions have a finite lifetime. If a load-test run reports mass `401`/redirect-to-login responses instead of the expected authenticated response, the pool has expired — refresh it via step 1 (10 real logins) before re-running, don't treat it as an application failure.
5. **The 300/500 VU stages and the write-path booking scenario reuse this exact same 10-account pool** — VU count scales the number of *concurrent requests*, never the number of *distinct logins/OTP sends*.

## 3. Ramp Stages

Every scenario below uses the same four-stage ramp, run independently for the public-browsing scenario and the authenticated-read scenario (both read-only, safe to run at every stage), and separately, at a reduced, explicitly-approved scale for the booking-creation (write) scenario (§5).

| Stage | Target VUs | Ramp-up | Hold | Ramp-down |
|---|---|---|---|---|
| 1 | 25 | 30s | 2m | 30s |
| 2 | 100 | 1m | 3m | 1m |
| 3 | 300 | 2m | 5m | 1m |
| 4 | 500 | 2m | 5m | 1m |

## 4. Scenario A — Public Browsing (read-only, k6 HTTP)

Script: [`scripts/load-test/public-browsing.js`](../../scripts/load-test/public-browsing.js). Each iteration: homepage → `/en/services` (listing) → a real Service Detail page → `/en/providers/[idOrSlug]` → `/sitemap.xml` (occasional, 1-in-20 iterations, since it's larger and not the core path) → `/api/health` (every iteration, cheap, doubles as a live health signal during the test itself).

**Thresholds (pass/fail)**:
```js
thresholds: {
  http_req_duration: ['p(50)<400', 'p(95)<1200', 'p(99)<2500'],
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
}
```

## 5. Scenario B — Authenticated Booking Flow

Two parts, deliberately kept separate:

**B1 — Authenticated reads** (dashboard, my bookings, provider dashboard if a provider-role session is in the pool): plain k6 HTTP, safe at every ramp stage, same thresholds as Scenario A. Script: [`scripts/load-test/authenticated-dashboard.js`](../../scripts/load-test/authenticated-dashboard.js).

**B2 — Booking creation (write path)**: k6 **browser module**, real headless-Chromium session driving the actual booking form (`/en/services/[id]/book`). **This is the "expensive/destructive" scenario the mission requires explicit approval for** — it writes real `Booking`/`Availability` rows to the staging database on every successful iteration. Script: [`scripts/load-test/authenticated-booking-browser.js`](../../scripts/load-test/authenticated-booking-browser.js).

- **Do not run B2 at 300 or 500 VUs without separate, explicit approval, even if B2 at lower VU counts has already been approved** — browser-module VUs are far heavier (a real Chromium instance each) than HTTP VUs, and each successful iteration is a real database write.
- **Recommended B2 scale, pending approval**: 5, then 20, then 50 concurrent browser sessions — not the full 25/100/300/500 ramp — specifically because this is a write path against a shared, capacity-limited resource (the 10-account session pool, and the availability slots those accounts book against), not a stateless read.
- B2 thresholds:
```js
thresholds: {
  browser_http_req_duration: ['p(95)<4000'],
  checks: ['rate>0.95'],
}
```

## 6. Metrics to Capture

- **p50 / p95 / p99 response time** — per scenario, via k6's built-in `http_req_duration` (Scenario A/B1) and `browser_http_req_duration` (B2) trend metrics — exported automatically to the k6 summary/JSON output.
- **Error rate** — `http_req_failed` rate (A/B1) and `checks` failure rate (B2, since browser-module iterations are checked by assertion, not raw HTTP status alone).
- **Throughput** — iterations/second and requests/second, both in k6's default end-of-run summary.
- **Database pressure** — k6 cannot observe this directly; it must be cross-referenced against the staging database provider's own metrics dashboard (active connection count, CPU%, query latency) for the exact wall-clock window the load test ran, using the pooled `DATABASE_URL` configured in [`STAGING_DEPLOYMENT_CHECKLIST.md`](STAGING_DEPLOYMENT_CHECKLIST.md) §3. Record: peak active connections, peak CPU%, and whether the pooler ever queued/rejected a connection during Stage 3 or 4.

## 7. Explicit Pass/Fail Thresholds (summary)

| Scenario | p95 | p99 | Error rate | Pass condition |
|---|---|---|---|---|
| A — Public browsing | <1200ms | <2500ms | <1% | All four stages meet threshold |
| B1 — Authenticated reads | <1200ms | <2500ms | <1% | All four stages meet threshold |
| B2 — Booking creation (write) | <4000ms | — | <5% check-failure rate | Approved VU counts only; DB connection pool never exhausted (§6) |

**A stage is a hard fail** if `http_req_failed` (or B2's check-failure rate) breaches threshold, **or** if the external uptime monitor ([`STAGING_DEPLOYMENT_CHECKLIST.md`](STAGING_DEPLOYMENT_CHECKLIST.md) §7) reports `/api/health` going non-200 at any point during the run — a load test that degrades health-check availability is a fail regardless of what k6's own numbers say.

## 8. Running (for reference — do not run without approval per stage)

```bash
# Scenario A, single stage example (25 VU)
k6 run --stage 30s:25,2m:25,30s:0 scripts/load-test/public-browsing.js

# Full 4-stage ramp, Scenario A
k6 run scripts/load-test/public-browsing.js

# Scenario B1
k6 run scripts/load-test/authenticated-dashboard.js

# Scenario B2 — requires separate approval; reduced VU set, browser module
k6 run scripts/load-test/authenticated-booking-browser.js
```

## Related Documents
- [`STAGING_DEPLOYMENT_CHECKLIST.md`](STAGING_DEPLOYMENT_CHECKLIST.md) — the environment this plan targets
- [`SECURITY_SCAN_PLAN.md`](SECURITY_SCAN_PLAN.md) — run separately, not concurrently with the load test (avoid conflating security-scan traffic with load-test metrics)
