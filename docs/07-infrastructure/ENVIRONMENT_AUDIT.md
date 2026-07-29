# BARQ Environment Variable Audit

- **Purpose:** A complete, classified inventory of every environment variable this application actually reads, cross-checked against real `process.env` reads in `src/` and `scripts/` — not against `.env.example`'s own claims. Companion to `.env.example` (which documents *how* to set each value) and `scripts/env-schema.ts` (the executable source of truth for what's *required*).
- **Scope:** Classification only (Required / Optional / Conditional / Development Only), plus an honest fifth bucket for variables that exist in `.env.example` but are not yet read by any code path.
- **Status:** Added — Go-Live Preparation phase.
- **Method:** Every variable below was confirmed via a direct `grep -rn "process.env.<NAME>"` against `src/` and `scripts/` before being classified — no variable is listed from `.env.example`'s claims alone.

---

## Classification Legend

| Class | Meaning |
|---|---|
| **Required** | Every environment (dev, CI, staging, production) must set this — the app cannot start meaningfully without it. |
| **Optional** | Has a safe, working default; may be left unset anywhere. |
| **Conditional** | Required only when another variable selects a code path that needs it (e.g. `OTP_PROVIDER=twilio`), or only in `NODE_ENV=production`. |
| **Development Only** | A *value* (not the variable itself) that must never be used in production — flagged where that distinction matters. |
| **Reserved (Not Yet Consumed)** | Present in `.env.example` for a documented future feature, but zero code in `src/` reads it today. Not one of the four requested categories — called out separately rather than forced into a misleading bucket. |

---

## Required

| Variable | Enforced by | Notes |
|---|---|---|
| `DATABASE_URL` | `scripts/env-schema.ts` (always) | PostgreSQL connection string (ADR-0006). Must point at an isolated production database/credential — never shared with staging. |
| `BETTER_AUTH_SECRET` | `scripts/env-schema.ts` (always); **≥32 chars enforced only when `NODE_ENV=production`** | Signs Better Auth sessions. Generate fresh per environment (`openssl rand -base64 32`) — never reuse a value from `.env`/CI. |
| `BETTER_AUTH_URL` | `scripts/env-schema.ts` (always) | Server-side base URL Better Auth validates callbacks against. Also gates the auth cookie's `secure` flag in production (`src/lib/auth/server.ts`). |
| `NEXT_PUBLIC_BETTER_AUTH_URL` | `scripts/env-schema.ts` (always) | Same origin, browser-exposed for the Better Auth client. Must match `BETTER_AUTH_URL`. |

## Conditional

| Variable | Required when | Notes |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `NODE_ENV=production` | Optional in dev (falls back to `http://localhost:3000` — `src/lib/seo/build-public-url.ts`). Resolves every canonical/hreflang/Open Graph/sitemap URL — wrong or missing in production means every indexed URL is wrong. |
| `CRON_SECRET` | `NODE_ENV=production` | Optional in dev (the cron route simply isn't invoked locally). Authenticates Vercel Cron's call to `/api/cron/expire-stale-bookings` — without it in production, that route rejects every request, including the real scheduled one. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | `OTP_PROVIDER=twilio` | Required together, in every environment that sets `OTP_PROVIDER=twilio` (not just production) — `get-otp-provider.ts` throws immediately if any is missing. |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | `PAYMENT_PROVIDER=STRIPE` | Required together, in every environment that sets `PAYMENT_PROVIDER=STRIPE`. Left unset while `PAYMENT_PROVIDER=NONE` (the default) — the webhook endpoint stays reachable but functionally inert (fails closed with a 500). **Not activated by this or any prior phase per explicit constraint.** |

## Optional

| Variable | Default | Notes |
|---|---|---|
| `OTP_PROVIDER` | `console` | See Development-Only note below — `console` is safe only in dev. |
| `OTP_CHANNEL` | `sms` | `"sms"` or `"whatsapp"`, only meaningful when `OTP_PROVIDER=twilio`. |
| `PAYMENT_PROVIDER` | `NONE` | `"NONE"` keeps every payment call resolving to the safe no-op provider — nothing in this codebase can move money without this being explicitly changed. |
| `OTP_EXPIRES_IN_SECONDS` | `300` | Matches Better Auth's own phoneNumber plugin default. |
| `OTP_MAX_ATTEMPTS` | `3` | Matches Better Auth's own phoneNumber plugin default. |
| `OTP_RESEND_COOLDOWN_SECONDS` | `30` | This project's own addition (no Better Auth built-in equivalent). |
| `OTP_MAX_SENDS_PER_DAY` | `10` | This project's own addition — the real SMS-cost abuse cap once a real provider is live. |
| `CONTRACT_SIGNATURE_LOG_IP` | enabled (`true`) if unset | Set to `"false"`/`"0"` to disable IP capture on contract signatures. |
| `RATE_LIMIT_BOOKING_CREATE_MAX` | `20` | Production Hardening phase. Per-customer, per-hour. |
| `RATE_LIMIT_BOOKING_CREATE_WINDOW_SECONDS` | `3600` | Production Hardening phase. |
| `RATE_LIMIT_REVIEW_CREATE_MAX` | `20` | Production Hardening phase. |
| `RATE_LIMIT_REVIEW_CREATE_WINDOW_SECONDS` | `3600` | Production Hardening phase. |

## Development Only (value, not variable)

| Variable | Dev-only value | Enforcement |
|---|---|---|
| `OTP_PROVIDER` | `console` | `scripts/env-schema.ts` independently forbids this value when `NODE_ENV=production`; `src/lib/otp/providers/console-provider.ts` also self-refuses to run when `NODE_ENV=production`, as a second, redundant gate. Never rely on only one of these two gates when reasoning about safety. |

## Reserved (Not Yet Consumed) — present in `.env.example`, zero real code reads them today

| Variable | Intended future feature | Confirmed via |
|---|---|---|
| `OBJECT_STORAGE_ENDPOINT` / `OBJECT_STORAGE_KEY` / `OBJECT_STORAGE_SECRET` | Object storage for file uploads (`TECH_STACK.md` §7) — provider not yet selected | `grep -rn` against `src/` — zero matches |
| `WHATSAPP_API_TOKEN` | Direct WhatsApp Business API integration (`TECH_STACK.md` §10) — Phase D.4's WhatsApp OTP support instead goes through Twilio's own WhatsApp channel (`OTP_CHANNEL=whatsapp`), not this token | `grep -rn` against `src/` — zero matches |
| `LLM_GATEWAY_API_KEY` | AI Agent / LLM Gateway abstraction (`TECH_STACK.md` §11) — not yet built | `grep -rn` against `src/` — zero matches |
| `GOOGLE_MAPS_API_KEY` | Maps/location display (`TECH_STACK.md` §9) — not yet built | `grep -rn` against `src/` — zero matches |

**On "remove obsolete examples" (per this phase's instruction):** none of the four variables above are obsolete — each corresponds to a named, still-planned future feature in `TECH_STACK.md`, documented in `.env.example` precisely so a future implementer knows the variable name is already reserved. "Obsolete" would mean a variable left over from a removed/renamed feature; a direct repo-wide search found none — every variable in `.env.example` maps to either a real, currently-consumed code path or a real, still-planned one. No deletions were made.

---

## Related Documents
- `.env.example` — the values/setup instructions this audit classifies
- `scripts/env-schema.ts` — the executable Zod source of truth for what's *required*, especially in production
- `docs/07-infrastructure/PRODUCTION_READINESS.md` §3 — the pre-existing "why" narrative this audit classifies formally
- `docs/07-infrastructure/PRODUCTION_RUNBOOK.md` — uses this classification during deployment
