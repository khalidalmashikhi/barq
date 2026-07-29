# BARQ Electronic Signature & Contract Execution

- **Purpose:** Documents the contract execution workflow built in Phase E.3 — signing, signature-provider abstraction, secure download, public verification, and notification hooks, layered on top of (never modifying) Phase E.2's Contract Engine.
- **Scope:** Signature state machine, signature provider interface, signature records, execution timeline, secure download, verification, notifications, audit logging.
- **Out of Scope:** A real, external signature vendor integration (Internal Signature is this phase's only working path); a real QR image generator (URL-only placeholder); automatic execution start on contract issuance (prepared, not wired); a scheduled job that auto-expires stale executions (a lazy, sign-time check only).
- **Owner:** Whoever builds the next Business Feature that touches contract execution (a real e-signature vendor, dispute/renewal handling, an actual scheduled expiry job) — keep current as this grows.
- **Status:** Added Phase E.3 (Electronic Signature & Contract Execution).

---

## 1. Architecture

```
src/lib/contracts/execution/
├── states.ts, transitions.ts, errors.ts, hooks.ts,
│   transition-execution.ts, index.ts    The Signature Execution Engine
│                                        (mirrors lifecycle/'s own shape exactly)
├── signature-providers/
│   ├── signature-provider.ts             SignatureProvider interface
│   ├── internal-signature-provider.ts     The only real, working provider
│   └── get-signature-provider.ts         Factory (reserved: GOVERNMENT_PKI, ADOBE_SIGN, DOCUSIGN, OMAN_TRUST_SERVICES)
├── ip-config.ts                          Privacy-aware IP capture toggle
├── verification.ts                       Token generation/verification + QR-placeholder URL
├── notify.ts                             Notification hooks, reusing the existing Notification model
├── start-execution.ts                    Starts the signing workflow for a generated contract
├── sign-contract.ts                      The core signing action
├── view-contract.ts                      VIEWED event recorder
├── download-contract.ts                  Authenticated PDF fetch, reusing Phase E.2's recordContractDownloaded
├── signed-url.ts                         Reserved interface for future object-storage-backed downloads
└── get-execution-status.ts               Read-only status/signature summary

src/app/api/contracts/
├── [id]/download/route.ts                Authenticated download (mirrors Phase E.1's history-route RBAC)
└── verify/[token]/route.ts               Public, unauthenticated verification
```

**Nothing in `src/lib/contracts/lifecycle/` (Phase E.2's own Contract Engine) was modified.** This phase adds a parallel, additive workflow: a `BookingContract` still moves through its own `DRAFT/GENERATED/ISSUED/ACTIVE/...` lifecycle exactly as Phase E.2 built it; `ContractExecution` tracks the signing process specifically, and reaching `EXECUTED` calls the Contract Engine's own, unmodified `transitionContractAndFireHooks()` to move the contract `ISSUED -> ACTIVE` — using the existing engine's public API, never bypassing or duplicating it.

## 2. Execution Flow

1. A contract reaches `ISSUED` (Phase E.2, untouched) — a future call to `startContractExecution(contractId)` (not wired this phase — see §7) creates its `ContractExecution` row (`PENDING_CUSTOMER`), a verification token, an expiry deadline, and sends the "Contract Ready" notification to the customer.
2. The customer calls `signContract({ contractId, signerType: "CUSTOMER", ... })`. This validates the execution is actually `PENDING_CUSTOMER` (see §5 for what "invalid order" means concretely), records a `ContractSignature` row, and — in one transaction — transitions `PENDING_CUSTOMER -> CUSTOMER_SIGNED -> PENDING_PROVIDER`. The `PENDING_PROVIDER` hook sends the "Reminder to Sign" notification to the provider.
3. The provider calls `signContract({ contractId, signerType: "PROVIDER", ... })`. Same validation, a second `ContractSignature` row, and `PENDING_PROVIDER -> PROVIDER_SIGNED -> EXECUTED`. Reaching `EXECUTED` additionally calls the Contract Engine's `transitionContractAndFireHooks({ contractId, toStatus: "ACTIVE", ... })` — the contract itself becomes `ACTIVE`. Both parties get the "Executed" notification.
4. At any point before `EXECUTED`, the execution can be cancelled (`transitionExecutionAndFireHooks({ toStatus: "CANCELLED" })`) or, if past its deadline, rejected at sign-time with `ContractExecutionExpiredError` (no automatic background expiry this phase — see §7).
5. Independently of all the above: `recordContractViewed()` and `getContractPdfForDownload()` (via `GET /api/contracts/[id]/download`) can be called any number of times, at any point after the contract has `content` — they never touch `ContractExecutionStatus`.
6. `verifyContractToken()` (via the public `GET /api/contracts/verify/[token]`) can be called by anyone, at any time, with the execution's token.

## 3. Signature State Diagram

```
PENDING_CUSTOMER ──► CUSTOMER_SIGNED ──► PENDING_PROVIDER ──► PROVIDER_SIGNED ──► EXECUTED
       │                                        │
       ├──────────────► CANCELLED ◄─────────────┤
       └──────────────► EXPIRED    ◄─────────────┘
```

| From \ To | PENDING_CUSTOMER | CUSTOMER_SIGNED | PENDING_PROVIDER | PROVIDER_SIGNED | EXECUTED | CANCELLED | EXPIRED |
|---|---|---|---|---|---|---|---|
| PENDING_CUSTOMER | — | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ |
| CUSTOMER_SIGNED | ❌ | — | ✅ | ❌ | ❌ | ❌ | ❌ |
| PENDING_PROVIDER | ❌ | ❌ | — | ✅ | ❌ | ✅ | ✅ |
| PROVIDER_SIGNED | ❌ | ❌ | ❌ | — | ✅ | ❌ | ❌ |
| EXECUTED / CANCELLED / EXPIRED | ❌ | ❌ | ❌ | ❌ | — | — | — |

`CUSTOMER_SIGNED -> PENDING_PROVIDER` and `PROVIDER_SIGNED -> EXECUTED` are each fired as part of one atomic `signContract()` call — "just signed" and "now waiting on the next party" happen together, matching requirement #1's own sequential example (four distinct states, not a shortcut). Only the two `PENDING_*` states can be cancelled or expire — by the time a signature is recorded, cancelling that specific momentary step no longer makes sense.

All three terminal states have **no outgoing transition** — deliberately, following a real lesson from Phase E.1's own history: an early design temptation was a `EXPIRED -> ACTIVE`-style "renewal" edge, rejected here for the same reason Phase E.1 rejected a speculative `DISPUTED` edge — a real renewal feature needs its own actor-aware rule, not a reused generic one.

## 4. Domain Model — Additions

Two new, purely additive models (zero changes to `BookingContract`, `BookingContractStatus`, or any Phase E.2 table):

- **`ContractExecution`** — one row per `BookingContract` that has entered the signing workflow (`@unique` on `contractId`). Holds `status` (§3), a unique `verificationToken` (§6), and `expiresAt`.
- **`ContractSignature`** — one **immutable** row per actual signing event (requirement #3). `@@unique([executionId, signerType])` is the database-level guarantee against duplicate signatures — not merely an application check. Stores `signerType`/`signerId`, `signedAt`, `ipAddress` (privacy-aware, §8), `userAgent` (optional), `method` (`INTERNAL`/`EXTERNAL_PROVIDER`), `providerKey` (a plain string, like Phase E.2's `templateKey` — a new vendor never needs a migration), and `providerReference` (unused by `INTERNAL`, reserved for a future vendor's own reference ID).

`BookingContractEventType` (Phase E.2) gained four new, purely additive values: `VIEWED`, `CUSTOMER_SIGNED`, `PROVIDER_SIGNED`, `EXECUTED`. Adding enum values is a non-breaking Postgres operation (no rename/removal) — Phase E.2's own `getContractHistory()` requires **zero changes** to pick these up; it already reads every event generically, ordered by time. This is requirement #4's "Contract Execution Timeline" — the exact same mechanism as Phase E.2's "Contract History," not a new one.

## 5. Signature Provider Interface

```ts
interface SignatureProvider {
  readonly key: string;
  readonly method: ContractSignatureMethod;
  sign(request: SignatureRequest): Promise<SignatureResult>;
}
```

`getSignatureProvider(key)` is the one factory that selects a provider — mirrors `get-otp-provider.ts` (Phase D.4) and `get-contract-template.ts` (Phase E.2) exactly. `INTERNAL` (implemented) is a simple, synchronous in-app assertion of consent — no external call, no cryptographic signature, no per-document hash. `GOVERNMENT_PKI`, `ADOBE_SIGN`, `DOCUSIGN`, and `OMAN_TRUST_SERVICES` (requirement #2's named examples) are recognized keys that throw a clear "reserved, not implemented" error today.

**A note on naming, to avoid future confusion:** Phase E.2 already defined an `ElectronicSignatureProvider` interface (`src/lib/contracts/extensions/future-extensions.ts`) as an unimplemented placeholder, shaped for an *asynchronous* request-then-verify-later vendor flow (`requestSignature()` / `verifySignature()`). This phase's `SignatureProvider.sign()` is a deliberately different, *synchronous* shape — because `INTERNAL` (this phase's actual, working requirement) is synchronous, and forcing it through an async request/verify shape would be artificial. Both interfaces now exist, under different names, for different reasons:
- `ElectronicSignatureProvider` (E.2): a placeholder for a fully async vendor flow — still unimplemented.
- `SignatureProvider` (E.3): the real, working abstraction, used by `signContract()` today.

A future real vendor integration (DocuSign, etc.) will need to decide which shape actually fits its own async webhook-driven reality — likely `ElectronicSignatureProvider`'s shape, bridged into `SignatureProvider` via an adapter, or `SignatureProvider` extended with an optional async variant. That design decision is explicitly not made here.

"Invalid signing order" and "duplicate signatures" (requirement #9's own named test scenarios) are caught by **one single check** in `signContract()`: the execution's current status must be exactly the `PENDING_*` status that expects a signature from the given `signerType` right now. A provider signing first, or a customer signing twice, both fail that one check.

## 6. Verification

`verifyContractToken(token)` — 100% internal database lookup by an opaque, crypto-random token (`crypto.randomBytes(24).toString("base64url")`), generated once at execution start and never rotated (a rotating token would invalidate a QR code already printed on an issued contract). Deliberately the *opposite* of a contract number (Phase E.2): a contract number is sequential and human-readable by design; a verification token must be unguessable, since anyone holding it can look up execution status through the public endpoint.

The public endpoint (`GET /api/contracts/verify/[token]`) returns **only** `{ valid, contractNumber?, status?, executedAt? }` — never `content`/terms, never signer identities. "QR placeholder" (requirement #6) is `getVerificationUrl(token, baseUrl)` — a URL string a QR code *would* encode; no actual QR image is generated (that needs a real QR-encoding library, a dependency decision out of this foundation phase's scope).

## 7. Security

- **Uniform 404s**: both the download route and (implicitly, via `{valid:false}`) the verification route never distinguish "doesn't exist" from "exists but you can't see it" — mirroring Phase E.1's own history-route pattern, preventing ID/token enumeration.
- **Download authorization**: owning Customer, owning Provider, or Admin only — re-derived from the database on every request, never trusted from the URL.
- **IP privacy**: `CONTRACT_SIGNATURE_LOG_IP` (default enabled) lets a deployment disable IP capture on signatures entirely — `resolveSignatureIp()` returns `null` regardless of what the caller had available when disabled.
- **Never logged**: contract `content`/terms never appear in any `logger.*` call this phase adds (`contract.viewed`, `contract.downloaded`, `contract.execution_transitioned`, `contract.execution_hook_failed` all carry only IDs/status/actor-role values).
- **No wiring to unrelated systems**: Authentication, OTP, Booking Lifecycle, RBAC, and the Contract Engine's own lifecycle are all untouched.

## 8. Notifications (Requirement #7)

There is no existing "create notification" service function anywhere in the codebase (`src/lib/notifications/` is read-only — every prior `Notification` row came only from the seed script) — so "reuse the existing notification architecture" means reusing the `Notification` **model's own shape** (bilingual `content`, `channel`, `causingBookingId` — Phase D.1's schema, unmodified) via `notify.ts`, not calling a nonexistent service. Four kinds are wired into real call sites: `CONTRACT_READY` (execution start), `SIGN_REMINDER` (`PENDING_PROVIDER` hook), `EXECUTED` (both parties), `EXPIRED` (both parties).

## 9. Remaining Future Work

- Wire `startContractExecution()` into `src/lib/contracts/lifecycle/hooks.ts`'s `onIssued()` — one line, in a future phase (this phase's rules explicitly forbid modifying that file).
- Implement a real signature vendor (`GOVERNMENT_PKI`/`ADOBE_SIGN`/`DOCUSIGN`/`OMAN_TRUST_SERVICES`) and resolve the `SignatureProvider` vs. `ElectronicSignatureProvider` shape question (§5).
- A scheduled job that transitions stale `PENDING_*` executions to `EXPIRED` automatically — today, expiry is only a lazy check inside `signContract()`.
- A real QR image encoder (§6) — currently a URL string only.
- `SignedUrlProvider` (`signed-url.ts`) — once contract PDFs are persisted to real object storage, rather than generated on demand in memory.
- Any UI (a contract detail page, a "sign here" flow, a Provider/Customer Dashboard surface) — this phase, like E.2, built the library and two minimal API routes only.
