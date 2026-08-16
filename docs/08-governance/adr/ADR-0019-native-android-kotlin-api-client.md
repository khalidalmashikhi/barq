# ADR-0019 — Native Android (Kotlin/Jetpack Compose) as a First-Class BARQ API Client (ADR-0011 Amendment)

- **Purpose:** Record that BARQ's second native mobile client is a **Native Android app built in Kotlin/Jetpack Compose**, consuming the same authoritative BARQ backend over the same versioned HTTP APIs. This exercises the option `ADR-0018` §Decision 6 explicitly left open ("This decision does not prohibit a future Android and/or React Native client"), and supersedes — for Android specifically — the "native mobile is out of V1" deferrals in `docs/02-domain-architecture/TECH_STACK.md` §"Mobile Apps" and `docs/01-product/PRODUCT_REQUIREMENTS.md` §6, exactly as `ADR-0018` did for iOS. Everything else in `ADR-0011` (API-first mandate, single authoritative domain layer, `/api/v1` versioning, platform-independence boundary) is reaffirmed unchanged.
- **Scope (this ADR):** the client-technology decision only, its repository location, and the invariants the Android client must honour. It authorizes no schema, auth, booking, pricing, payment, RBAC, or API change; it does not itself build or modify any API surface. Android implementation detail (module layout, libraries, screen sequencing) is deliberately **not** recorded here — it belongs to the Android repository.
- **Out of Scope (unchanged, not touched here):** authentication architecture (Better Auth phone-OTP cookie sessions — `ADR-0009`), RBAC, booking lifecycle, pricing/commission, payments, provider verification (`ADR-0017`), taxonomy (`ADR-0016`). Authenticated and mutating `/api/v1` surfaces already exist under their own gates and are not altered. Push notifications, native social sign-in, and any client-driven API addition remain later, separately-approved gates.
- **Dependencies:** `ADR-0011` (API-first, mobile-ready — the ADR this amends), `ADR-0018` (native iOS — the precedent this follows), `ADR-0009` (Better Auth user separation — the cookie-session identity Android will reuse), `ADR-0005`/`ADR-0010` (bilingual/multilingual content), `ADR-0006` (UUID baseline).
- **Status:** Accepted. Native Android is an approved first-class API client. Client implementation (Kotlin/Gradle) is tracked separately and is not part of this repository.
- **Owner:** Khalid Al-Mashikhi (Platform Owner).

---

## Context

`ADR-0011` ("API-First, Mobile-Ready Architecture," Approved/Locked) established that business capabilities are exposed through stable, versioned APIs (`/api/v1/...`), and that business logic lives in exactly one reusable place, never duplicated per client platform. `ADR-0018` then selected Native iOS (Swift/SwiftUI) as the first mobile client, established that a native client reuses the existing Better Auth cookie session with **no backend change**, and explicitly stated that a future Android client would need no reversal of that decision.

Since `ADR-0018`, the versioned surface has grown well past the public read foundation: authenticated customer read (Gate 2), booking mutations (Gate 3), provider read (Gate PB), and provider mutations (Gate PC) all exist as thin adapters over `src/lib/**`, sharing one error envelope, one pagination shape, one locale resolver, and allow-list DTOs. That surface is client-agnostic by construction — it was never iOS-specific — so a second native client requires **no new API and no auth change** to deliver a substantial first release.

A read-only Android discovery audit confirmed this against the actual repository rather than against documentation claims, and additionally confirmed that the existing cookie session is natively consumable by a standard Android HTTP client through ordinary cookie replay, exactly as it is by `URLSession` on iOS.

## Decision

1. **Native Android (Kotlin/Jetpack Compose) is an approved first-class BARQ API client**, on equal footing with BARQ Web and BARQ iOS.
2. **BARQ Web, iOS, and Android MUST reuse the same authoritative backend/domain logic.** Business rules (validation, pricing, availability, capacity, booking transitions, permissions, commissions, verification requirements) exist once in `src/lib/**` and are never reimplemented per client. Android holds no BARQ business rule.
3. **Android must never connect directly to PostgreSQL or Supabase.** No database driver, connection string, or Supabase service-role credential ever ships in a client. All data access and all storage authorization go through BARQ's HTTP APIs. Anything shipped inside an APK is public and must be treated as such.
4. **`/api/v1` is the Android contract boundary.** Android consumes the same versioned surface as every other client; breaking changes create a new version rather than mutating an existing one. Android may not introduce a mobile-only API or BFF with its own logic.
5. **The existing authentication architecture is reused, not replaced.** Android authenticates through the existing Better Auth phone-OTP endpoints and replays the resulting session cookie. **No bearer/JWT scheme is introduced.** Any change to the authentication contract required by Android is a separate, explicitly-approved decision — never a side effect of client work.
6. **Android lives in its own repository (`barq-android`), separate from this Platform repository**, following the precedent `ADR-0018` set for `barq-ios`. The Platform repository records the *decision* and the *contract*; the Android repository records the *implementation*. Neither repository edits the other.
7. **Android-specific UX remains platform-native.** Product meaning, domain terminology, API semantics, error meaning, authentication lifecycle, and BARQ brand identity stay consistent across clients; UI implementation does not. Android uses Android patterns (Jetpack Compose, Material 3 as a foundation, Android navigation and lifecycle) rather than mirroring SwiftUI or the web DOM. Material dynamic color must not override BARQ brand identity.
8. **Arabic (RTL) and English are foundational, not retrofitted.** Android supports the `ADR-0010` locale set structurally from the start, with `ar`/`en` correct from the first build.
9. **Cross-client compatibility must be preserved.** Android work must not break BARQ Web, BARQ iOS, the backend, existing APIs, or existing deployments. Additive API change is the only acceptable shape if a gap is found, and only through its own approval gate.

## Consequences

**Positive:** the second native client is authorized without disturbing any locked decision; the single-source-of-truth, API-versioning, and no-direct-DB invariants are reinforced across three clients rather than two; the repository-separation precedent stays consistent between the two mobile clients; a clear, testable boundary is stated for reviewers.

**Negative / Cost:** a third client increases the surface over which API contracts are **hand-mirrored** — no OpenAPI or generated schema exists in this repository, so a server DTO change carries no compile-time signal for either mobile client. This is a real, accepted cost of this decision and is recorded as such; adopting a machine-readable contract source is a separate architecture proposal, not a prerequisite for this ADR. Android also inherits the gaps the current API does not cover (verification-document upload, provider media, provider application, reviews, payments, push notifications), each of which remains its own gate.

## Alternatives considered (rejected)

- **Amend `ADR-0018` in place:** rejected — `ADR-0018` is Accepted; a new amending ADR is the repository convention and preserves the historical record.
- **Android inside the Platform repository (monorepo):** rejected — it would diverge from the `barq-ios` precedent for no stated benefit, drag a Gradle toolchain into a Vercel deployment target, and force path-filtering onto a CI workflow that exists to validate the web application. The contract-drift benefit a monorepo would provide is better solved by a machine-readable contract source, which is independent of repository layout.
- **React Native / a cross-platform client to serve both mobile platforms:** rejected on the same grounds `ADR-0018` rejected it — a native experience per platform was chosen deliberately. Reuse holds at the API layer, not the UI layer.
- **A bearer/JWT token scheme "because mobile":** rejected — cookie replay is verified sufficient for a native client, and introducing a second authentication mechanism would add real security surface to solve a problem that does not exist.
- **Deferring Android until an OpenAPI contract exists:** rejected — the contract gap is real but is already being absorbed by iOS today; blocking a client on it would trade a known, manageable cost for an indefinite delay. It is recorded as a consequence instead.

## Related

`ADR-0011` (amended by this ADR), `ADR-0018` (the precedent this follows), `ADR-0009`, `ADR-0005`, `ADR-0010`, `ADR-0006`; `docs/project-memory/23-IOS-API-AUTH-INTEGRATION.md` (the iOS-facing integration note whose Android sibling is written when Android auth integration is actually implemented); `src/app/api/v1/**`, `src/lib/api/v1/**`.
