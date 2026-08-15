# 23 — iOS ⇄ API v1 Auth Integration Note (developer-facing)

Short, practical note for building the native BARQ iOS (Swift/SwiftUI) client against the existing backend. **No auth architecture change is required or made** — this documents how a native `URLSession` client reuses the current Better Auth cookie session. Governance: ADR-0018 (native iOS as a first-class API client), ADR-0009 (Better Auth user separation). All facts below verified against `src/lib/auth/server.ts` and the installed Better Auth (1.6.23).

## The flow (reuse — do NOT reimplement)

```
iOS  →  POST /api/auth/phone-number/send-otp    { phoneNumber }
     →  POST /api/auth/phone-number/verify       { phoneNumber, code }   ← sets the session cookie
     →  GET  /api/v1/me            (cookie replayed automatically)
     →  GET  /api/v1/me/bookings, /api/v1/me/notifications, ...
```

- **OTP request:** `POST /api/auth/phone-number/send-otp`, JSON body `{ phoneNumber }`. `Content-Type: application/json` is required (Better Auth router `allowedMediaTypes`).
- **OTP verify:** `POST /api/auth/phone-number/verify`, JSON `{ phoneNumber, code }`. On success Better Auth **creates a DB-backed session and sets the session cookie** (and also returns a `token` in the body — not independently usable without its HMAC signature; rely on the cookie, not the body token).
- **Authenticated calls:** send the session cookie; `/api/v1/me*` resolves it via `requireAuth()` and returns the customer's data.
- **Logout:** `POST /api/auth/sign-out` (deletes the session row, expires the cookie).

## Session cookie (what the client must retain)

- Name: `better-auth.session_token` → `__Secure-better-auth.session_token` in production.
- Attributes: `HttpOnly` (always), `Secure` (production), `SameSite=Lax`, `Path=/`, `Domain` unset, `Max-Age` 604800s (**7-day** expiry, **1-day** rolling refresh).
- **`URLSession` retains and resends it automatically** via `HTTPCookieStorage` (the default, non-ephemeral session config). `HttpOnly` does **not** block a native client from storing/sending the cookie — it only blocks browser JS. Use a non-ephemeral `URLSession` (or persist cookies yourself); an `.ephemeral` config would drop the session between launches.

## CSRF / origin (native is fine)

Better Auth's origin check is **cookie-gated and skipped for the cookieless login handshake**, so `send-otp`/`verify` need no `Origin` header and `trustedOrigins` needs no native scheme. After login, `/api/v1/*` endpoints authenticate purely from the cookie via `requireAuth()` with no origin check — normal authenticated native usage is unaffected. (Do not call Better Auth's own `/api/auth/*` mutation endpoints with the cookie attached unless you also send an allowed `Origin`.)

## Error contract for auth

- No/expired session → **401** `{ "error": { "code": "UNAUTHORIZED", "message": "…localized…" } }`.
- Inactive account (SUSPENDED/DEACTIVATED) → **403** `{ "error": { "code": "FORBIDDEN", … } }` (enforced by `requireAuth()`'s status denylist even with a still-valid cookie).

## Locale

Send `?locale=<ar|en|de|it|pl|fr|cs|ru>` (or rely on `Accept-Language`; default `ar`). Same resolver as the public API.

## Phone-entry UX contract (Web ⇄ iOS parity — for the later native SwiftUI gate)

The Web login now uses a **global-ready phone entry** (country picker), while authentication stays **Oman-only**. The native iOS client should match this product behavior (native SwiftUI UI, not shared code). This is a UX contract only — **DO NOT edit the separate `barq-ios` repo from the Platform repo.**

**Collapsed field:** `[ 🇴🇲  +968  ▾ ] [ national number ]` — the calling code + number render **LTR** in every locale; the user never retypes `+968`.

**Country picker (tap the country segment):**
- Searchable, local/offline (no API per keystroke). Search matches: English name, Arabic name (diacritic-tolerant — `عمان` finds `عُمان`), ISO alpha-2 (`OM`), and calling code with/without `+` (`+968`, `968`).
- Each row: flag, localized name, secondary name, `ISO · +code`.
- **Oman is enabled; every other country shows a "coming soon" chip and is not selectable for auth.** No IP/geo detection.
- Mobile: bottom-sheet; RTL for Arabic, LTR for English; accessible tap targets, focus-on-open, dismiss on close.

**Authentication rule (identical to Web / server):** only Oman (`+968`) is supported. The client composes the national number into the canonical **`+968XXXXXXXX`** (the same P0-1 contract) and calls `POST /api/auth/phone-number/send-otp`. An unsupported country must **never** call send-otp — show "Phone authentication is not available in this country yet." The **server (P0-1 canonicalization + P1 durable rate limiting) remains authoritative** regardless of client UI; country selection is UI input, never a security authority.

**Enabling more countries later is a paired change** (Platform gate): UI `authSupported` + server-side canonicalization/OTP policy together — never one without the other. The Platform source of truth is `src/lib/countries/registry.ts` + `src/components/auth/phone-entry.ts`.

## Not in scope here

No bearer/JWT is added (cookie replay is sufficient for the MVP). No booking mutations, no push notifications, no Swift code — those are later, separately-approved gates.
