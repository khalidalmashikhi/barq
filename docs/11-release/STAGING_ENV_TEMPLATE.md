# BARQ — Staging Environment Variable Template

Production-safe **staging** environment-variable template. Names, descriptions, and formats only — **no real secret values ever appear in this file**. This lists exactly the variables the running staging deployment needs, and nothing more: every variable here is actually consumed by code (verified by repo-wide `process.env` search), and reserved/unused variables are deliberately excluded (see the final section).

The single source of truth for what is *required* is `scripts/env-schema.ts`, enforced at build/start by `scripts/validate-env.ts`. Vercel sets `NODE_ENV=production` automatically for any deployed instance, so staging is validated against the same production-only rules the real production deploy will face.

## Legend

| Marker | Meaning |
|---|---|
| 🔒 **GENERATED** | A secret you generate fresh for staging (e.g. `openssl rand -base64 32`). Never commit it, never reuse a local-dev or production value. |
| 🔑 **SECRET** | A credential value (not self-generated — issued by a provider). Treat as sensitive; never commit. |
| 🌐 **PUBLIC** | Prefixed `NEXT_PUBLIC_` — inlined into the client JS bundle at **build time**. Never put a secret here; changing it requires a rebuild, not just a redeploy. |
| ⚠️ **MUST DIFFER FROM PRODUCTION** | Using the production value in staging is a defect (shared secret, or staging pointing at production infrastructure). |
| `=literal` | Fixed value for staging — set exactly as shown. |

---

## 1. Required variables (staging will not build/start without these)

Set every variable in this section in the **staging** Vercel project's environment-variable scope only.

### Database

| Variable | Description | Expected format |
|---|---|---|
| `DATABASE_URL` 🔑 ⚠️ | Connection string for the **isolated** staging Postgres. Must be the **session-mode pooled** endpoint (no-code path — see `STAGING_PROVISIONING_PREP.md`), never the production DB, never a developer's local DB. | `postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require` (Supabase session pooler uses port `5432`) |

### Authentication (Better Auth)

| Variable | Description | Expected format |
|---|---|---|
| `BETTER_AUTH_SECRET` 🔒 ⚠️ | Session-signing secret. **≥ 32 characters** (enforced once `NODE_ENV=production`, i.e. always on staging). | Random 32+ char string, e.g. output of `openssl rand -base64 32` |
| `BETTER_AUTH_URL` ⚠️ | Server-side base URL Better Auth issues/validates callbacks against. Must be the staging origin, not production, not `localhost`. | Absolute URL, e.g. `https://staging.<domain>` |
| `NEXT_PUBLIC_BETTER_AUTH_URL` 🌐 ⚠️ | Same origin as above, exposed to the browser client (`src/lib/auth/client.ts`). | Absolute URL, identical to `BETTER_AUTH_URL` |

### Public site URL

| Variable | Description | Expected format |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` 🌐 ⚠️ | Public origin used for `metadataBase`/canonical/hreflang/Open Graph and for `robots.txt`/`sitemap.xml` absolute URLs. Required in production (so, on staging). | Absolute URL, staging origin, e.g. `https://staging.<domain>` |

### Cron authentication

| Variable | Description | Expected format |
|---|---|---|
| `CRON_SECRET` 🔒 ⚠️ | Bearer token that authenticates Vercel Cron's call to `/api/cron/expire-stale-bookings`. Required in production (so, on staging). | Random string, e.g. output of `openssl rand -base64 32` |

### OTP delivery (Twilio)

BARQ uses **Twilio Programmable Messaging** (the REST Messages API) — it generates the OTP itself and sends it as an SMS body. It does **not** use Twilio Verify and does **not** use a Messaging Service SID, so no Verify/Messaging-Service variable exists. **Twilio Test Credentials are simulation-only and cannot deliver a real OTP** — staging must use **live** credentials from a **separate staging Twilio project/subaccount** (never production's). See `STAGING_EXECUTION_GUIDE.md` §5 for the two-level verification model.

| Variable | Description | Expected format |
|---|---|---|
| `OTP_PROVIDER` | Active OTP vendor. **`console` is refused under `NODE_ENV=production`**, so staging must use Twilio. | `=twilio` |
| `OTP_CHANNEL` | Delivery channel. Staging pins SMS. | `=sms` |
| `TWILIO_ACCOUNT_SID` 🔑 ⚠️ | **Live** staging Twilio Account SID (from a separate staging project/subaccount — **not** the console's Test Credentials, and **not** production's). | `AC` followed by 32 hex chars |
| `TWILIO_AUTH_TOKEN` 🔑 ⚠️ | **Live** staging Auth Token for the account above. | 32-char token |
| `TWILIO_FROM_NUMBER` ⚠️ | **Live** staging sender (SMS-capable), distinct from production's. Must be eligible to deliver to the approved recipient(s). | E.164, e.g. `+14155238886` |

### Payments

| Variable | Description | Expected format |
|---|---|---|
| `PAYMENT_PROVIDER` | Payment vendor. Kept at the approved launch state — the No-Op provider, which cannot move money. Do **not** enable Stripe in staging. | `=NONE` |

---

## 2. Optional variables (consumed by code, safe to omit — omitting accepts the code default)

Set only if you deliberately want to override the default. All are read via a "parse-or-default" helper, so an unset value is valid.

| Variable | Description | Default if unset |
|---|---|---|
| `OTP_EXPIRES_IN_SECONDS` | OTP validity window. | `300` |
| `OTP_MAX_ATTEMPTS` | Max verification attempts per code. | `3` |
| `OTP_RESEND_COOLDOWN_SECONDS` | Min seconds between resends. | `30` |
| `OTP_MAX_SENDS_PER_DAY` | Rolling-24h cap on sends per phone (real SMS-cost abuse guard). | `10` |
| `RATE_LIMIT_BOOKING_CREATE_MAX` | Per-customer booking-create limit. | `20` |
| `RATE_LIMIT_BOOKING_CREATE_WINDOW_SECONDS` | Window for the above. | `3600` |
| `RATE_LIMIT_REVIEW_CREATE_MAX` | Per-customer review-create limit. | `20` |
| `RATE_LIMIT_REVIEW_CREATE_WINDOW_SECONDS` | Window for the above. | `3600` |
| `CONTRACT_SIGNATURE_LOG_IP` | Whether to persist signer IP on a `ContractSignature`. | enabled (`true`) |

> Note: the in-memory rate limits are per-serverless-instance, not global. For the Stage 2 Load Test, keep the defaults unless a scenario specifically requires otherwise.

---

## 3. Never set in staging (reserved / unused / managed elsewhere)

Deliberately excluded so the staging config stays minimal and production-safe. Setting these would either be a no-op or contradict the approved staging posture.

| Variable(s) | Why excluded |
|---|---|
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Only consumed when `PAYMENT_PROVIDER=STRIPE`. Staging keeps `PAYMENT_PROVIDER=NONE`, so these are unused. |
| `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_KEY`, `OBJECT_STORAGE_SECRET` | Documented in `.env.example` but **unconsumed by any code path** today (confirmed in `src/lib/contracts/execution/signed-url.ts`'s own comment). |
| `WHATSAPP_API_TOKEN`, `LLM_GATEWAY_API_KEY`, `GOOGLE_MAPS_API_KEY` | Reserved integration keys — documented in `.env.example`, read by **no** code path. |
| `NODE_ENV` | Managed automatically by Vercel for deployed instances (set to `production`). Never set it by hand. |
| `DIRECT_URL` / `directUrl` | Not part of the schema (no-code path). Introducing it is an approval-gated `schema.prisma` change, explicitly out of scope. |

---

## 4. Quick self-check before first deploy

Locally simulate the exact gate the staging build will run (replace `...` with real staging values in your shell only — never commit them):

```bash
NODE_ENV=production \
DATABASE_URL=... BETTER_AUTH_SECRET=... BETTER_AUTH_URL=... \
NEXT_PUBLIC_BETTER_AUTH_URL=... NEXT_PUBLIC_APP_URL=... CRON_SECRET=... \
OTP_PROVIDER=twilio TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_FROM_NUMBER=... \
PAYMENT_PROVIDER=NONE \
npm run validate-env
```

PowerShell (Windows): set each with `$env:NAME="..."` separated by `;` on one line, then `npm run validate-env`.

Expected: `Environment variables validated.` and exit code 0. Any missing/invalid variable prints an itemized `path: message` list and exits 1.
