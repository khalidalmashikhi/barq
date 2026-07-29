# BARQ Production OTP Integration

- **Purpose:** Documents the OTP (one-time password) delivery, hardening, and audit-logging system built in Phase D.4, which closes the "no production OTP delivery" blocker recorded in `PRODUCTION_READINESS.md` §1 and the Phase D.2 audit.
- **Scope:** OTP provider abstraction, delivery configuration, expiration/resend/rate-limit/failed-attempt behavior, audit logging, deployment steps, troubleshooting.
- **Out of Scope:** Session lifecycle after a successful sign-in (`AUTHENTICATION.md` §5's own open decision, unchanged by this phase), RBAC, Booking/Notification/Services/Dashboard flows (none of which this phase touches).
- **Owner:** Whoever operates authentication in production — keep current as providers/config evolve.
- **Status:** Added Phase D.4 (Production OTP Integration).

---

## 1. Architecture Summary

BARQ authenticates by phone number + OTP only (no email/password — `AUTHENTICATION.md` §4), via Better Auth's `phoneNumber` plugin (`src/lib/auth/server.ts`). That plugin already owns OTP **generation**, **storage**, **expiration**, and **failed-attempt limiting** internally — this phase does not reimplement any of that (see §3). What this phase adds is everything Better Auth's plugin leaves as an integration point or doesn't provide at all:

```
src/lib/otp/
├── provider.ts                    OtpProvider interface: { name, send({phoneNumber, code}) }
├── providers/
│   ├── console-provider.ts        Dev-only: prints to server terminal, refuses to run in production
│   └── twilio-provider.ts         Real SMS/WhatsApp delivery via Twilio's REST API (plain fetch)
├── get-otp-provider.ts            Factory: reads OTP_PROVIDER env var, selects/constructs a provider
├── otp-config.ts                  Reads OTP_EXPIRES_IN_SECONDS / OTP_MAX_ATTEMPTS / OTP_RESEND_COOLDOWN_SECONDS
├── check-resend-cooldown.ts       Resend-cooldown check (queries Better Auth's own Verification table)
└── audit.ts                       Structured audit logging + verify-outcome classification
```

`src/lib/auth/server.ts` wires these into Better Auth's own extension points:

- **`sendOTP` callback** — receives the code Better Auth already generated, hands it to `getOtpProvider().send(...)`, and logs `otp.sent` / `otp.send_failed`. Never generates, stores, or logs the code itself.
- **`expiresIn` / `allowedAttempts` plugin options** — now sourced from `otp-config.ts` instead of being left as implicit library defaults. The defaults (300s / 3 attempts) are unchanged from before this phase.
- **Root-level `hooks.before`**, scoped to `/phone-number/send-otp` — the resend-cooldown check (the one piece genuinely missing from Better Auth; see §3).
- **Root-level `hooks.after`**, scoped to `/phone-number/verify` — audit-logs the verification outcome (verified / expired / too-many-attempts / invalid).

**Nothing outside `src/lib/otp/` ever branches on a vendor name.** Switching providers, or adding a new one (SMSCountry, Infobip, etc.), is: implement `OtpProvider`, add one `case` to `get-otp-provider.ts`, done — `server.ts` and everything else is unchanged.

## 2. Provider Abstraction

```ts
export interface OtpProvider {
  readonly name: string;
  send(params: { phoneNumber: string; code: string }): Promise<void>;
}
```

This mirrors Better Auth's own `sendOTP` callback shape exactly, rather than inventing a new one — no adapter layer is needed between the plugin and a provider.

| Provider | Selected by | Behavior |
|---|---|---|
| `console` (default) | `OTP_PROVIDER=console` or unset | Prints `[DEV OTP] <phone> -> <code>` to the server terminal only. Throws if `NODE_ENV=production` — this is a dev-only safety net, in addition to §8's independent startup check. |
| `twilio` | `OTP_PROVIDER=twilio` | Sends via Twilio's Messages REST API (`POST /2010-04-01/Accounts/{sid}/Messages.json`) using plain `fetch` and HTTP Basic Auth — no `twilio` SDK dependency added. Supports both SMS and WhatsApp Business via `OTP_CHANNEL`; WhatsApp prefixes both `To` and `From` with `whatsapp:`, per Twilio's own convention. |

Adding a future provider (e.g. SMSCountry, Infobip): create `src/lib/otp/providers/<vendor>-provider.ts` implementing `OtpProvider`, add a `case "<vendor>":` branch in `get-otp-provider.ts`, document its env vars in `.env.example`. No other file changes.

## 3. What Better Auth Already Provides (and why it isn't reimplemented)

Read directly from the installed `better-auth@1.6.23` source (`node_modules/better-auth/dist/plugins/phone-number/routes.mjs`) before writing any code this phase, to avoid duplicating functionality the library already owns:

- **Expiration** — `verifyPhoneNumberOTP` checks `expiresAt < now`, deletes the row, and throws `OTP_EXPIRED`. Fully built-in; this phase only makes the duration configurable (`expiresIn`, from `OTP_EXPIRES_IN_SECONDS`).
- **Failed-attempt protection** — the same function tracks attempts (encoded in the stored `Verification.value` as `"<code>:<attempts>"`) against `allowedAttempts`, throwing `TOO_MANY_ATTEMPTS` and deleting the row once exceeded. This invalidates *that OTP*, not the account or phone number — a fresh `send-otp` call immediately allows another attempt, satisfying "do NOT permanently lock users." This phase only makes the threshold configurable (`allowedAttempts`, from `OTP_MAX_ATTEMPTS`).
- **Rate limiting** — Better Auth's root rate limiter is **enabled by default in production** (`rateLimit.enabled ?? isProduction`, confirmed in `node_modules/better-auth/dist/context/create-context.mjs`), IP-keyed, 100 requests/10s by default. The `phoneNumber` plugin additionally registers its own stricter rule for every `/phone-number/*` path: 10 requests per 60 seconds (`node_modules/better-auth/dist/plugins/phone-number/index.mjs`). **No code was added for this** — it is already active with zero configuration. This document is the record of that decision; see §7 to change the defaults if ever needed.
- **What is genuinely missing:** a resend cooldown. Nothing in the plugin prevents calling `/phone-number/send-otp` repeatedly — each call just overwrites the stored code with a fresh expiry. `check-resend-cooldown.ts` closes this gap by querying the plugin's own `Verification` table (`identifier`, `createdAt` — no new Prisma model) for the most recent row for that phone number.

## 4. OTP Lifecycle

1. Client calls `POST /phone-number/send-otp` with a phone number.
2. `hooks.before` logs `otp.requested`, then checks the resend cooldown via `check-resend-cooldown.ts`. If a code was requested for this number within `OTP_RESEND_COOLDOWN_SECONDS`, the request is rejected with `429 TOO_MANY_REQUESTS` and `otp.resend_rejected` is logged — Better Auth's own handler never runs.
3. Otherwise, Better Auth generates the code, persists it (`Verification` table, `expiresAt` = now + `OTP_EXPIRES_IN_SECONDS`), and calls the plugin's `sendOTP` callback, which delegates to the configured `OtpProvider`. `otp.sent` (success) or `otp.send_failed` (provider threw — the error is rethrown so the client sees a real failure, not a false "code sent") is logged.
4. Client calls `POST /phone-number/verify` with the code.
5. Better Auth checks expiration and attempt count internally (§3), consumes the stored value, and compares codes.
6. `hooks.after` classifies the result (`src/lib/otp/audit.ts`'s `classifyVerifyOutcome`) and logs exactly one of: `otp.verified`, `otp.expired`, `otp.too_many_attempts`, `otp.invalid`.

## 5. Environment Variables

See `.env.example` for the authoritative, inline-documented list. Summary:

| Variable | Required when | Default | Purpose |
|---|---|---|---|
| `OTP_PROVIDER` | Always resolves to one; **must not be `console` in production** (enforced by `scripts/validate-env.ts`) | `console` | Selects the delivery vendor. |
| `TWILIO_ACCOUNT_SID` | `OTP_PROVIDER=twilio` | — | Twilio Account SID. |
| `TWILIO_AUTH_TOKEN` | `OTP_PROVIDER=twilio` | — | Twilio Auth Token. Never logged. |
| `TWILIO_FROM_NUMBER` | `OTP_PROVIDER=twilio` | — | E.164 SMS number, or approved WhatsApp Business sender. |
| `OTP_CHANNEL` | Optional | `sms` | `sms` or `whatsapp` — only meaningful for the Twilio provider. |
| `OTP_EXPIRES_IN_SECONDS` | Optional | `300` | How long a code is valid. Matches Better Auth's own plugin default. |
| `OTP_MAX_ATTEMPTS` | Optional | `3` | Failed attempts before that code is invalidated. Matches Better Auth's own plugin default. |
| `OTP_RESEND_COOLDOWN_SECONDS` | Optional | `30` | Minimum time between two `send-otp` calls for the same number. This project's own addition — no Better Auth equivalent. |

`scripts/env-schema.ts` (used by `scripts/validate-env.ts`, which runs automatically before `dev`/`build`) fails the process immediately if `OTP_PROVIDER=twilio` is set without all three Twilio credentials, in any environment, and independently fails production builds specifically if `OTP_PROVIDER` resolves to `console`.

## 6. Deployment

1. Choose a provider and obtain its credentials (e.g. a Twilio account, phone number/WhatsApp sender, Account SID, Auth Token).
2. Set `OTP_PROVIDER=twilio` (or a future provider's name) and its required variables in the production environment — never commit real values.
3. Run `NODE_ENV=production npm run validate-env` against the target environment before deploying — it will fail loudly if `OTP_PROVIDER` is still `console` or if Twilio credentials are incomplete.
4. Deploy normally (see `PRODUCTION_READINESS.md` for the full checklist — that document's §1 blocker is resolved once this phase's configuration is in place).
5. Smoke-test: request an OTP against a real test phone number, confirm delivery, confirm `otp.sent` appears in structured logs (never the code itself), confirm verification succeeds and logs `otp.verified`.

## 7. Troubleshooting

| Symptom | Likely cause | Check |
|---|---|---|
| Build/start fails with "must not be console in production" | `OTP_PROVIDER` unset or `console` in a production environment | Set `OTP_PROVIDER=twilio` (or another real provider) with its credentials. |
| Build/start fails listing missing `TWILIO_*` variables | `OTP_PROVIDER=twilio` set without all three credentials | Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`. |
| `otp.send_failed` logged, client sees a send-otp error | The provider's `send()` rejected (e.g. Twilio returned a non-2xx) | The log's `reason` field includes Twilio's own error code/message (never the auth token) — cross-reference against Twilio's error code reference. |
| User reports "resend" button does nothing / shows an error immediately after requesting a code | Working as intended — `otp.resend_rejected` was logged | Expected until `OTP_RESEND_COOLDOWN_SECONDS` elapses. Lower the value if it's too strict for the product's UX. |
| Legitimate user gets rate-limited (`429`) after a handful of requests | Better Auth's own `/phone-number/*` rate limit (10 requests/60s) or root rate limit — both built-in, not custom code (§3) | If this is too strict for a real usage pattern, override via Better Auth's `rateLimit.customRules` in `src/lib/auth/server.ts` — not yet done, since the built-in defaults haven't been observed to be a problem. |
| `otp.expired` / `otp.too_many_attempts` / `otp.invalid` logged | Normal user-facing outcomes, not errors | These are Better Auth's own internal logic (§3) surfaced as audit events — no code path failed. |

## 8. Security Notes

- The OTP code is never logged, anywhere, by any log line this phase adds — confirmed by reading every `logger.*` call site added in this phase (`src/lib/otp/audit.ts`, `src/lib/auth/server.ts`).
- `logger.ts`'s `LogContext` type (Phase D.3) only accepts primitive values, structurally preventing an entire object (which could contain a code or token) from being spread into a log line by accident.
- Twilio credentials are sent only via the HTTP Basic Auth header to Twilio's own API — never logged, never placed in a URL/query string.
- The `console` provider is blocked from running in production twice over: it throws internally if `NODE_ENV=production`, and `scripts/validate-env.ts` independently refuses to start the process at all if `OTP_PROVIDER` resolves to `console` in production.
