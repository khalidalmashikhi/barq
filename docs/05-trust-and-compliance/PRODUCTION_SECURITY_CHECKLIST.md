# BARQ Production Security Checklist

- **Purpose:** A concrete, verify-it-yourself pre-launch checklist against BARQ's real, implemented security controls. Companion to `SECURITY.md` (the locked architectural security philosophy) — this document does not redefine or relitigate anything `SECURITY.md` already governs; it operationalizes a subset of it into exact commands and expected outputs for a real production deploy.
- **Scope:** HTTPS, cookies, CSP, security headers, secrets, environment variables, rate limiting, the health endpoint, and trusted origins — the concrete, code-level slice of `SECURITY.md` §3/§6/§8 relevant to a go-live check.
- **Out of Scope:** Everything `SECURITY.md` itself marks Out of Scope (specific encryption algorithms, cloud vendor configuration, firewall rules) plus anything `SECURITY.md` §16 lists as an Open Decision (key rotation cadence, alert thresholds, Payment Gateway vendor selection, data residency, penetration testing) — this checklist does not attempt to resolve those.
- **Status:** Added — Go-Live Preparation phase.
- **Relationship to `SECURITY.md`:** That document is "Approved v1.0 — Locked" (`ARCHITECTURE_FREEZE_V1.md`) and is not modified here or by this phase. This is a new, separate, non-locked companion.

---

## HTTPS

- [ ] TLS terminates somewhere in front of the application (host edge/CDN or reverse proxy) — BARQ itself sends `Strict-Transport-Security` but does not terminate TLS.
- [ ] Verify with the browser's own security panel against the real production URL, not just header presence — `curl` cannot itself confirm the certificate chain is trusted end-to-end.
- [ ] `curl -sI https://<production-domain>/ | grep -i strict-transport-security` returns `max-age=63072000; includeSubDomains; preload`.

## Cookies

- [ ] Session cookie (`better-auth.session_token` or its `__Secure-` prefixed form) carries `HttpOnly` — hardcoded by Better Auth unconditionally (verified directly against the installed library's own source — see `PRODUCTION_READINESS.md` §7).
- [ ] Session cookie carries `Secure` — resolves to `true` in production via `src/lib/auth/server.ts`'s explicit `advanced.useSecureCookies: process.env.NODE_ENV === "production"`. Confirm `NODE_ENV=production` is genuinely set in the deployed process (not only implied by `next build`).
- [ ] Session cookie carries `SameSite=Lax` — the library's own default, deliberately kept (matches BARQ's full-page-redirect OTP sign-in flow).
- [ ] Verify directly: browser DevTools → Application → Cookies, on a real HTTPS response from the deployed instance.

## Content-Security-Policy

- [ ] `curl -sI https://<production-domain>/ | grep -i content-security-policy` returns a real policy string (only emitted when `NODE_ENV=production` — `next.config.ts`).
- [ ] Confirm `'unsafe-inline'` remains present on `script-src`/`style-src` — a known, documented trade-off (no nonce infrastructure exists yet — see `PRODUCTION_READINESS.md` §9), not a regression to flag as new.
- [ ] Open the deployed site in a real browser, check the console for zero CSP violation reports across the public marketplace, login, Customer Dashboard, and Provider Dashboard.

## Security Headers

- [ ] `curl -sI https://<production-domain>/` shows all of: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(self)`, `Strict-Transport-Security`, and (production only) `Content-Security-Policy`.
- [ ] Confirm no `X-Powered-By: Next.js` header is present (`poweredByHeader: false` in `next.config.ts`).

## Secrets

- [ ] No secret value appears in this repository, a commit, a chat transcript, or `.env.example` (which documents variable *names* only, per its own header comment).
- [ ] `BETTER_AUTH_SECRET` is a fresh, randomly generated value (`openssl rand -base64 32`) — not reused from a local `.env`, CI fixture, or staging environment. `scripts/env-schema.ts` enforces ≥32 characters in production, but length alone doesn't prove it's genuinely fresh — verify this by process, not by the automated check alone.
- [ ] Confirm the hosting platform's own secret-management mechanism is what actually holds these values in production (not a committed `.env` file deployed alongside the build).

## Environment Variables

- [ ] Full classified inventory: `ENVIRONMENT_AUDIT.md`. Confirm every `Required` variable and every applicable `Conditional` variable is genuinely set for this specific deploy.
- [ ] `NODE_ENV=production npm run validate-env` passes against the real target environment.
- [ ] `OTP_PROVIDER` is not `console` (enforced, but verify the real intended provider is what's actually set — the check only proves it isn't the forbidden value, not that it's the *correct* one).

## Rate Limiting

- [ ] Confirm `RATE_LIMIT_*` env vars (if overridden from the defaults) reflect an intentional choice for this deploy's expected traffic, not a copy-pasted dev value.
- [ ] Understand the real limitation before relying on this control: in-memory, per-instance — not a global/durable limit (`src/lib/rate-limit/rate-limiter.ts`'s own module comment; restated in `PRODUCTION_READINESS.md` §7). This is a deterrent against casual scripted abuse on booking/review creation, not a substitute for the database-backed OTP resend-cooldown/daily-send-limit, which remains the security-critical rate control for the auth surface.
- [ ] Confirm the OTP-specific rate limits (`OTP_RESEND_COOLDOWN_SECONDS`, `OTP_MAX_SENDS_PER_DAY`) are set to values appropriate for the real OTP delivery vendor's own cost/abuse profile, not left at defaults without consideration.

## Health Endpoint

- [ ] `GET /api/health` is reachable, unauthenticated, and returns only enum-shaped status strings — never a secret, connection string, credential, or raw stack trace. Confirmed by direct code inspection (`src/app/api/health/route.ts` and its three checker modules) and by this phase's own test suite (`route.test.ts` asserts a simulated credential-shaped error string never reaches the response body).
- [ ] Confirm the endpoint is not itself rate-limited or blocked by any upstream WAF/proxy rule in a way that would prevent a real monitoring check from reaching it.

## Trusted Origins

- [ ] `src/lib/auth/server.ts`'s `trustedOrigins` resolves to `[BETTER_AUTH_URL, NEXT_PUBLIC_APP_URL]` (with `NEXT_PUBLIC_APP_URL` dropped if unset) — confirm both env vars are set to the **real production origin**, not a staging or preview URL, for this specific deploy.
- [ ] Confirm no wildcard or overly broad origin is ever added to this list — the codebase's own design keeps this to exactly the origins the app is actually served from.

---

## What This Checklist Does Not Cover (by design, per `SECURITY.md`'s own scope)

Encryption-at-rest specifics, key rotation cadence, alert thresholds, penetration testing, vendor security agreements, data residency, and the right-to-deletion-vs-audit-immutability tension — all genuinely open per `SECURITY.md` §16's Open Decisions, none resolved here or by this phase.

## Related Documents
- `SECURITY.md` — the locked architectural philosophy this checklist operationalizes a slice of, without modifying
- `PRODUCTION_READINESS.md` §7 — the rate-limiting/cookie-configuration narrative this checklist's items summarize into checkboxes
- `PRODUCTION_RUNBOOK.md` §1 step 10 — where this checklist is run in the deployment sequence
