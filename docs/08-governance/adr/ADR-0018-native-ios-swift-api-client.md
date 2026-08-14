# ADR-0018 — Native iOS (Swift/SwiftUI) as a First-Class BARQ API Client (ADR-0011 Amendment)

- **Purpose:** Record that BARQ's first native mobile client is a **Native iOS app built in Swift/SwiftUI**, consuming the same authoritative BARQ backend over versioned HTTP APIs. This amends — it does not rewrite — ADR-0011's illustrative expectation of React Native/Expo, which ADR-0011 itself scoped as changeable "pending its own future ADR." Everything else in ADR-0011 (API-first mandate, single authoritative domain layer, `/api/v1` versioning, platform-independence boundary) is reaffirmed unchanged.
- **Scope (this ADR):** the client-technology decision only, plus the invariants any client (web, iOS, future Android/RN) must honour. It authorizes no schema, auth, booking, pricing, payment, or RBAC change; it does not itself build any API surface (the public read-only `/api/v1` foundation is delivered under the same Gate that lands this ADR, governed by the design in *BARQ iOS MVP API v1 — Backend-Verified Proposed Integration Design*).
- **Out of Scope (unchanged, not touched here):** authentication architecture (Better Auth phone-OTP cookie sessions — ADR-0009), RBAC, booking lifecycle, pricing/commission, payments, provider verification (ADR-0017), taxonomy (ADR-0016), `regionCode`/`pricingUnit`, BR-028, Vehicle/Asset, Dynamic Fields, OAuth. Authenticated and mutating `/api/v1` surfaces are later, separately-approved gates.
- **Dependencies:** `ADR-0011` (API-first, mobile-ready — the ADR this amends), `ADR-0009` (Better Auth user separation — the cookie-session identity iOS will reuse), `ADR-0005`/`ADR-0010` (bilingual/multilingual content), `ADR-0006` (UUID baseline).
- **Status:** Accepted. Native iOS is an approved first-class API client. Client implementation (Swift/Xcode) is tracked separately and not part of this repository.
- **Owner:** Khalid Al-Mashikhi (Platform Owner).

---

## Context

ADR-0011 ("API-First, Mobile-Ready Architecture," Approved/Locked) established the binding requirement that business capabilities be exposed through stable, versioned APIs (`/api/v1/...`), and that business logic live in exactly one reusable place, never duplicated per client platform. In enumerating its scope it named React Native/Expo as the *expected* future mobile stack, explicitly qualifying that expectation as subject to change "pending its own future ADR if changed" — i.e. it deliberately deferred the concrete client-technology choice to a later decision, which this ADR now makes.

BARQ has selected **Native iOS (Swift/SwiftUI)** as the first mobile client. This choice does not alter any BARQ backend architecture: iOS is simply another consumer of the same versioned API and the same authoritative `src/lib/**` domain logic that BARQ Web already uses. A prior read-only audit (*BARQ Backend → iOS Verified Integration Contract*) confirmed the existing Better Auth phone-OTP **cookie session is natively consumable by `URLSession` via cookie replay with no backend change**, so no new authentication mechanism is required for the mobile MVP.

## Decision

1. **Native iOS/SwiftUI is an approved first-class BARQ API client**, on equal footing with BARQ Web. This amends ADR-0011's illustrative React Native/Expo expectation; all other ADR-0011 provisions remain in force.
2. **BARQ Web and BARQ iOS MUST reuse the same authoritative backend/domain logic.** Business rules (validation, pricing, availability, capacity, booking transitions, permissions, commissions) exist once in `src/lib/**` and are never reimplemented per client. API routes are thin HTTP/DTO adapters over those existing functions — never a parallel implementation.
3. **iOS must never connect directly to PostgreSQL or Supabase.** No database driver, connection string, or Supabase service-role credential ever ships in a client. All data access and all storage authorization go through BARQ's HTTP APIs; the database and service-role key remain server-only.
4. **Public and mobile-facing APIs are versioned under `/api/v1`** (reaffirming ADR-0011 §5). Breaking changes create a new version rather than mutating an existing one.
5. **Existing BARQ Web behavior remains fully supported.** Server Actions and Server Components continue to serve the web UI; adding API adapters must not change any existing web behavior. The web is and remains a first-class client.
6. **This decision does not prohibit a future Android and/or React Native client.** Any such client would consume the same versioned APIs and the same authoritative domain logic; adopting one needs no reversal of this ADR.

## Consequences

**Positive:** the concrete mobile-client choice ADR-0011 deferred is now recorded without disturbing any locked decision; the single-source-of-truth and API-versioning mandates are reinforced; a clear, testable boundary ("no direct DB/Supabase from clients") is stated for reviewers; future platforms remain open.

**Negative / Cost:** committing to native iOS now means Android would be a separate client effort later (accepted — cross-platform reuse still holds at the API layer, not the UI layer). A small, additive locale-parameter decoupling is required on a few public read functions so a non-`[locale]` API route can serve any of the 8 locales; it is optional and preserves existing web behavior exactly (see the Gate-1 implementation).

## Alternatives considered (rejected)

- **Amend ADR-0011 in place / rewrite its history:** rejected — ADR-0011 is Accepted/Locked; a new amending ADR is the repository convention and preserves the historical record.
- **React Native/Expo now (ADR-0011's illustrative expectation):** rejected by the platform owner in favour of a native Swift/SwiftUI experience for the first mobile client; not foreclosed for the future.
- **A separate mobile-only API/BFF with its own logic:** rejected — it would violate ADR-0011's "exactly one reusable place" mandate and this ADR's reuse invariant.

## Related

`ADR-0011` (amended by this ADR), `ADR-0009`, `ADR-0005`, `ADR-0010`, `ADR-0006`; *BARQ Backend → iOS Verified Integration Contract* and *BARQ iOS MVP API v1 — Backend-Verified Proposed Integration Design* (planning artifacts); `src/app/api/v1/**`, `src/lib/api/v1/**`.
