# BARQ — Release Candidate Checklist

> The **Go-Live Release Checklist** immediately below is the current, living pre-launch checklist (added by the Go-Live Preparation phase). Everything under **Phase F.5 Historical Record** further down is a dated snapshot from that specific phase's own completion report — kept for its historical detail, not maintained as a living checklist. Where the two disagree (e.g. sitemap status), the Go-Live Release Checklist above is correct; the historical section has been corrected in place rather than left to silently contradict it.

---

## Go-Live Release Checklist (Go-Live Preparation phase)

Run through every item before considering a production deploy launch-ready. Each item names the exact command or check — not a vague restatement.

### Environment Validation
- [ ] `NODE_ENV=production npm run validate-env` passes against the real target environment's actual variables (not `.env` locally, not CI's placeholder values).
- [ ] Cross-check the full variable set against `ENVIRONMENT_AUDIT.md` — every `Required` and applicable `Conditional` variable is genuinely set.
- [ ] `OTP_PROVIDER` is not `console`; `PAYMENT_PROVIDER` is `NONE` unless a separately approved payment-activation phase says otherwise.

### Database Migration Verification
- [ ] `npx prisma migrate status` against the target database reports a clean, expected state before deploying.
- [ ] `npx prisma migrate deploy` runs (or has run, via `vercel-build`) before the new code serves traffic.
- [ ] `npx prisma migrate status` again reports "Database schema is up to date" after deploying.

### Health Endpoint Verification
- [ ] `GET /api/health` → `200`, `"status":"ok"`, `"database":"ok"`.
- [ ] `"otpProvider"` and `"paymentProvider"` both resolve to something other than `"misconfigured"`.
- [ ] `"environment":"ok"`.
- [ ] Optionally automate this with `npm run verify-deployment -- <production-url>` (added this phase — see `scripts/verify-deployment.ts`).

### OTP Verification
- [ ] `OTP_PROVIDER=twilio` (or another real provider) with real, environment-specific credentials — not a copied dev/staging value.
- [ ] Send a real test OTP to a real test phone number against the deployed instance and confirm delivery.
- [ ] Confirm server logs never show `[DEV OTP]` — the console provider's own dev-only log marker — in production output.

### Payment Configuration Verification
- [ ] `PAYMENT_PROVIDER=NONE` confirmed (unless this specific deploy is a separately approved payment-activation phase).
- [ ] `GET /api/health`'s `"paymentProvider"` field matches the intended value exactly.
- [ ] The payment webhook endpoint (`/api/webhooks/payments`) is reachable but confirmed inert (fails closed) if `PAYMENT_PROVIDER=NONE`.

### Sitemap Verification
- [ ] `GET /sitemap.xml` returns `200` with real, dynamic content (`src/app/sitemap.ts` — built in the Growth Foundations phase; **not** the "no sitemap" state some historical docs describe — see the note at the top of this file).
- [ ] Confirm entry count roughly matches `PUBLISHED` services + `APPROVED`/visible providers in the production database (order-of-magnitude sanity check, not an exact count).
- [ ] Confirm no admin/dashboard/bookings/payments/private route appears in the sitemap output.

### Robots Verification
- [ ] `GET /robots.txt` returns `200`.
- [ ] Confirms `Disallow` on every authenticated/private route group (`/dashboard`, `/bookings`, `/payments`, `/admin`, `/provider/*` operational pages, `/notifications`).
- [ ] Confirms a `Sitemap:` directive pointing at the real production `NEXT_PUBLIC_APP_URL`, not `localhost`.

### SEO Verification
- [ ] Spot-check a Service Detail page's rendered `<head>`: canonical URL, 8-locale hreflang + x-default, Open Graph `og:image` pointing at the real per-entity `opengraph-image` route (not the fallback static logo), `twitter:card` = `summary_large_image`.
- [ ] Spot-check the same for a Provider Detail page.
- [ ] Confirm JSON-LD structured data (`Product`/`LocalBusiness`) renders and is well-formed (no console parse errors).
- [ ] Confirm the Share button (Service Detail, Provider Detail, Booking Confirmation) produces a URL that resolves to the real production domain, not `localhost`.

### Localization Verification
- [ ] Language switcher functions across all 8 locales in the deployed instance.
- [ ] RTL (Arabic) renders correctly — layout mirrors, no visual breakage.
- [ ] Spot-check that the legacy untranslated-placeholder gap (`cs/de/fr/it/pl/ru` — see Known Limitations) is a knowingly accepted launch risk, not a surprise discovered post-launch.

### Production Smoke Tests
- [ ] Full `SMOKE_TEST_GUIDE.md` sequence (Customer, Provider, Admin) run against the real deployed instance — not a local/staging environment.

---

## Phase F.5 Historical Record

*(Everything below this line is the original Phase F.5 completion-report snapshot, dated to that phase specifically. Kept for historical accuracy; superseded as a living checklist by the Go-Live Release Checklist above.)*

## Architecture Status

Modular monolith (ADR-0002), Next.js 15 App Router, Prisma/PostgreSQL, better-auth phone-OTP, next-intl 8-locale i18n (ADR-0010), API-first/mobile-ready posture (ADR-0011). Customer, Provider, and Trust/Quality experiences complete (Phases F.1–F.4). No backend, schema, auth, OTP, booking-lifecycle, contract-engine, signature-engine, RBAC, or business-rule changes were made in F.5 — verified via mtime comparison against the first F.5 file touched.

## Production Readiness

- TypeScript, ESLint, Vitest, and `npm run build` all pass clean (see Verification section of the completion report).
- One genuinely unused dependency (`react-hook-form`) and one genuinely dead file (`src/lib/i18n/strings.ts`, superseded by next-intl) removed; `package-lock.json` regenerated to match.
- No duplicate live routes on disk (old pre-`[locale]` route trees are fully deleted, not just hidden).
- Security headers (CSP/HSTS/X-Frame-Options/etc.) unchanged from Phase D.3, still present.

## Known Limitations

1. **Legacy i18n gap (pre-existing, not F.5's doing):** 1,092 untranslated placeholder strings remain in `cs/de/fr/it/pl/ru` across `auth`/`booking`/`common`/`dashboard`/`errors`/`notifications`/`provider`/`seo`/`services`. Documented since Phase F.4 (`project_legacy_i18n_gap` memory), still deferred by explicit user decision.
2. **Loading-skeleton DOM anomaly (investigated exhaustively, unresolved):** on routes with a `loading.tsx` sibling, the automated browser-testing tool used in this engagement consistently shows the fallback skeleton remaining visible while the resolved page content renders into a `display:none` wrapper. Reproduced identically across dev mode, two independent from-scratch production builds, hard loads, and real client-side `<Link>` navigations — ruling out cache staleness and dev/Turbopack-only causes. Server-rendered HTML (verified via `curl`, zero JS) is 100% correct in every case, and no console error was ever produced. This could not be conclusively attributed to the shipped application code versus an artifact specific to the automated testing tool, since no non-automated browser was available to cross-check. **This is a mandatory pre-launch gate:** do a manual check in a real desktop browser (Chrome/Firefox/Safari) of `/services` and `/services/[id]` before going live.
3. ~~**No sitemap.xml**~~ **Corrected, Go-Live Preparation phase**: this was true as of Phase D.3/F.5 but is no longer accurate — a real, dynamic `src/app/sitemap.ts` was built in the Growth Foundations phase (enumerating `PUBLISHED` services and `APPROVED`/visible providers across all 8 locales) and `robots.ts` now references it. Left visible here, struck through rather than deleted, so this historical record doesn't silently misstate what was true in Phase F.5 while also not contradicting the current, correct Go-Live Release Checklist above.
4. **No dedicated Forbidden/Unauthorized page** — deliberate: existing `notFound()`/redirect-to-login pattern prevents confirming resource existence to unauthorized users; a distinct page would weaken that.
5. **`@playwright/test` is installed and scripted (`npm run test:e2e`) but has zero spec files** — documented in `TECH_STACK.md`/`DEPLOYMENT_AND_INFRASTRUCTURE.md` as intended stack, not yet built out.

## Technical Debt

- 1,092 legacy placeholder translation strings (see above) — largest single item.
- `src/lib/i18n/format-number.ts` and `src/lib/i18n/extract-localized-text.ts` are built, documented, but have zero call sites yet — several query modules (`get-services.ts`, `get-dashboard-data.ts`, etc.) still pre-format currency/number strings manually rather than using them, per `I18N_MESSAGE_CONVENTIONS.md`'s own noted anti-pattern.
- `src/components/ui/chip.tsx` and `src/components/ui/tabs.tsx` are built design-system primitives (Phase F.1) with no current consumer — available for future use, not dead, just unconsumed.
- `src/lib/contracts/index.ts` barrel file has no internal consumer (every call site imports from `lifecycle`/`execution` submodules directly) — plausibly intentional public API surface for future external/mobile consumers per ADR-0011, left in place rather than removed.

## Performance Status

- `next/image` used consistently for all real images (logo, destination images, service gallery) — no raw `<img>` tags bypassing optimization.
- 21 Client Components total across the app — each checked has a genuine reason (interactivity, browser APIs, hooks); no unnecessary Server→Client boundary crossings found.
- Bundle sizes reasonable and unchanged by this phase's cleanup (shared JS ~102 kB; per-route First Load JS 103–181 kB).
- `revalidatePath`/Server Actions used for cache invalidation on every mutation (booking cancel, notification read-state, etc.) — no stale-data risk found.

## Accessibility Status

Skip link, `id="main-content"` on every page, single-`<h1>`-per-page heading hierarchy, native `<details>/<summary>` disclosures, `prefers-reduced-motion` blanket override, `aria-label`/`aria-pressed`/`aria-disabled` on all interactive controls reviewed. No regressions found this phase. OTP inputs and phone field now carry `autocomplete` hints (`one-time-code`/`tel`) — the one new accessibility/usability improvement made in F.5.

## Security Status

Frontend-only review (backend/auth untouched, per phase rules): no `target="_blank"` without `rel="noopener"`; the only `dangerouslySetInnerHTML` use is the developer-controlled Organization JSON-LD (no user input); no client-side `process.env` access beyond the two legitimate `NEXT_PUBLIC_*` values; no `eval`/`new Function`/`javascript:` URLs; every `redirect()` target is either a hardcoded path or a server-controlled id/error-code, never raw user input (no open-redirect risk); CSP/HSTS headers unchanged from Phase D.3.

## SEO Status

Every public page has `generateMetadata()` with canonical + 8-locale hreflang + x-default, Open Graph, and Twitter Card. Exactly one Organization JSON-LD block (real `name`/`url`/`logo` only). `robots.ts` allows `/` and disallows only private routes. No sitemap (documented limitation, unchanged this phase).

## Localization Status

8 locales (ar/cs/de/en/fr/it/pl/ru) fully wired for every new page and component built through Phase F.4/F.5. Locale routing (`localePrefix: "always"`), RTL/LTR switching, and the language switcher all function correctly — verified live. The 1,092-string legacy gap (see Known Limitations) is the only outstanding localization debt.

## Deployment Checklist

- [ ] Confirm `.env` production values are set (`DATABASE_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL`, real SMS/WhatsApp OTP provider credentials — NOT the console provider)
- [ ] Run `npx prisma migrate deploy` against the production database
- [ ] Run `npm run build` in the deployment pipeline (already verified reproducible from a clean `.next/`)
- [ ] Manually smoke-test `/services` and `/services/[id]` in a real desktop browser (see Known Limitations #2)
- [ ] Confirm `/api/health` responds 200 post-deploy

## Rollback Checklist

- [ ] Keep the previous deployment's build artifact/image available for immediate redeploy
- [ ] Confirm the Prisma migration history allows a safe `prisma migrate resolve`/down-migration path if the new migrations need reverting
- [ ] No destructive migrations were introduced across F.1–F.5 (all additive: new models/columns, no drops) — rollback risk is low

## Post-Launch Monitoring Checklist

- [ ] Watch `/api/health` uptime
- [ ] Watch server logs (structured via `src/lib/logger.ts`) for `auth.unauthenticated_access_attempt` spikes (could indicate broken links or bot traffic) and `otp.send_failed` (real SMS provider issues)
- [ ] Watch for the loading-skeleton anomaly (Known Limitations #2) in real user session recordings/support reports, since it could not be conclusively ruled out in this environment
- [ ] Confirm the console OTP provider never runs in production (it self-refuses today — verify server logs never show `[DEV OTP]` in production)
