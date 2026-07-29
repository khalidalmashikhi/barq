# BARQ — External Security-Validation Plan (Staging)

Produced by the Code Freeze / Operational Validation phase. **Targets the isolated staging environment only** ([`STAGING_DEPLOYMENT_CHECKLIST.md`](STAGING_DEPLOYMENT_CHECKLIST.md)). **No scan has been executed.** This plan is passive-first by design, per the mission's own constraint ("do not run active security attacks without explicit approval") — the OWASP ZAP portion is scoped to a passive scan only; any active scan is called out as a distinct, separately-approved step, not bundled into the default run.

---

## 1. OWASP ZAP Passive Scan

Passive scanning observes real traffic (a normal crawl/spider) and flags issues from response headers/content alone — it never sends attack payloads, so it's safe to run without the same approval gate an active scan needs.

```bash
docker run -v $(pwd)/zap-reports:/zap/wrk/:rw \
  -t zaproxy/zap-stable zap-baseline.py \
  -t https://staging.example.invalid \
  -r zap-baseline-report.html \
  -J zap-baseline-report.json
```

`zap-baseline.py` is ZAP's own passive-only baseline scan (spiders the site, passively analyzes every response — never fuzzes/attacks). Replace the target URL with the real staging domain from [`STAGING_DEPLOYMENT_CHECKLIST.md`](STAGING_DEPLOYMENT_CHECKLIST.md) §6.

**Expected/acceptable passive findings to triage, not panic over**: informational cookie-attribute notes, missing `Referrer-Policy` on third-party-embedded resources (there are none — no third-party script/iframe exists in this codebase per the CSP audit in `next.config.ts`), and low-severity "X-Content-Type-Options missing" on static assets Vercel itself serves (not application-controlled).

**Findings that are real regressions and must block go/no-go**: any Medium+ finding on an application-rendered page (not a static asset) — e.g. missing CSP, missing HSTS, a reflected-input finding, or a session cookie missing `Secure`/`HttpOnly`.

## 2. Authenticated Route Checks

Using the same pre-authenticated session pool as the Load Test Plan ([`LOAD_TEST_PLAN.md`](LOAD_TEST_PLAN.md) §2 — no additional OTP sends required):

- [ ] Confirm every route under `/[locale]/dashboard`, `/[locale]/bookings`, `/[locale]/provider/*`, `/[locale]/admin/*`, `/[locale]/payments` returns a redirect-to-login (not a 200, not a raw stack trace) when hit **without** a session cookie.
- [ ] Confirm the same routes return `200` with the correct role's own data when hit **with** the correct role's pooled session cookie (Customer session → Customer data only; Provider session → Provider data only; Admin session → Admin data only).
- [ ] Confirm a Customer session cannot reach `/[locale]/provider/*` or `/[locale]/admin/*` (expect a redirect/403, never the provider/admin page content).
- [ ] Confirm a Provider session whose `Provider.status` is `APPROVED` succeeds on provider routes; this is also the natural point to **re-verify the provider-deactivation gap-closure fix** (Phase 10 of this engagement) is intact in staging specifically — a `DEACTIVATED`/`SUSPENDED` test provider session must receive `403` on `/api/bookings/[id]/history` and `/api/contracts/[id]/download`, not the pre-fix silent bypass.

## 3. Authorization / IDOR Checks

Direct-object-reference probing against the app's own uniform-404 anti-enumeration pattern (already implemented for bookings/contracts — see [`rbac.ts`](../../src/lib/auth/rbac.ts)'s `resolveProviderStatus()` and both routes' own tests):

- [ ] As the pooled Customer A session, request `GET /api/bookings/{a-real-booking-id-belonging-to-a-different-customer}/history`. Expect `404`, never `403` and never the real timeline data — a `200` here is a Critical finding (cross-tenant data leak).
- [ ] Same check against `GET /api/contracts/{other-customer's-contract-id}/download`. Expect `404`, never a downloadable PDF.
- [ ] As the pooled Provider session, attempt the same two endpoints against a booking/contract belonging to a **different** provider. Expect `404`.
- [ ] Attempt to view another customer's booking detail page directly (`/[locale]/bookings/{other-customer-id}`) via the UI route, not just the API — confirm the page-level query also enforces ownership (not only the two API routes audited in Phase 10), since a page-level IDOR would be a distinct, newly-discovered finding, not a re-confirmation of the already-fixed gap.
- [ ] Attempt sequential/guessable ID enumeration is moot here since every ID in this schema is a UUID (ADR-0006) — confirm this is still true by inspecting one real staging ID's shape, rather than assuming.

## 4. Security-Header Verification

```bash
curl -sI https://staging.example.invalid/en | grep -iE "content-security-policy|strict-transport-security|x-content-type-options|x-frame-options|referrer-policy|permissions-policy"
```

Expected (per `next.config.ts`'s `headers()`, confirmed present in code — this step re-confirms they're actually served, not just configured):
- `Content-Security-Policy` present (only when `NODE_ENV=production`, which the staging deployment sets — see §1's note on Vercel setting this automatically).
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
- `X-Content-Type-Options: nosniff`.
- `X-Frame-Options: DENY`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy: camera=(), microphone=(), geolocation=(self)`.

**A missing header here is a hard fail** — it means either `NODE_ENV` isn't actually set to `production` on the staging deployment (a staging-config error, fix and re-scan) or a genuine regression in `next.config.ts` since the Phase D.3 audit that first verified these.

## 5. TLS Verification

```bash
echo | openssl s_client -connect staging.example.invalid:443 -servername staging.example.invalid 2>/dev/null | openssl x509 -noout -dates -issuer

curl -sI https://staging.example.invalid | head -1
```

- [ ] Certificate is valid (not expired, correct hostname) — Vercel auto-issues/renews this once the domain is attached; this step confirms it actually happened for the staging domain, not just assumes it.
- [ ] `curl -I http://staging.example.invalid` (plain HTTP) redirects to HTTPS — Vercel's default behavior; confirm rather than assume.
- [ ] No mixed content: load the homepage in a real browser, check DevTools console for any `Mixed Content` warning (would indicate an asset hardcoded to `http://` somewhere).
- [ ] TLS version: confirm the negotiated protocol is TLS 1.2 or 1.3 only (`openssl s_client ... -tls1_1` should fail to connect) — Vercel's default edge configuration already disables older protocols; this step confirms it for this specific domain rather than assuming platform-wide defaults apply uniformly.

## 6. Active Scan (explicitly separate, requires approval)

Not part of the default plan above. If the owner separately approves an **active** ZAP scan (`zap-full-scan.py`, which does send attack payloads — SQLi/XSS fuzzing, etc.):
- Must run against staging only, never production.
- Must run outside any concurrent load-test window (avoid conflating security-scan traffic with load-test metrics, and avoid the load test's booking-creation writes interacting unpredictably with ZAP's own fuzzed inputs).
- Given this app's actual attack surface (Prisma-parameterized queries throughout, no raw SQL string interpolation found in any prior audit this session, Server Actions rather than hand-rolled API bodies for most mutations), the highest-value active-scan target is the handful of real REST route handlers (`src/app/api/*/route.ts`) and the Better Auth-handled `/api/auth/[...all]` catch-all — not the Server-Action-driven pages, which ZAP's crawler cannot meaningfully fuzz the same way (see [`LOAD_TEST_PLAN.md`](LOAD_TEST_PLAN.md) §1's identical observation about Server Actions).

## Related Documents
- [`STAGING_DEPLOYMENT_CHECKLIST.md`](STAGING_DEPLOYMENT_CHECKLIST.md) — the environment this plan targets
- [`PRODUCTION_SECURITY_CHECKLIST.md`](../05-trust-and-compliance/PRODUCTION_SECURITY_CHECKLIST.md) — the broader security checklist this plan operationalizes for staging specifically
- [`LOAD_TEST_PLAN.md`](LOAD_TEST_PLAN.md) §2 — the same session pool reused here to avoid additional OTP sends
