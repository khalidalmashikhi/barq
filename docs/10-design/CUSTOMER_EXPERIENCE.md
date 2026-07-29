# BARQ Customer Experience — Booking Journey

- **Purpose:** Documents the presentation-layer work delivered in Phase F.2 (Customer Experience & Booking Journey) — the search → detail → book → confirmation → my bookings path, and the principles behind each decision. Companion to `docs/10-design/DESIGN_SYSTEM.md` (tokens/primitives) and `docs/04-experience/DESIGN_SYSTEM.md` (locked principles).
- **Scope:** Search Experience, Search Results, Experience Detail Page, Booking Flow, Booking Confirmation, My Bookings, Booking Timeline, Provider Presentation, Reviews/Maps placeholders, loading/motion/accessibility notes.
- **Out of Scope:** Business logic, schema, Auth/OTP, Contracts, Booking Engine internals — none were touched this phase; every change below is presentation-layer, reusing existing queries or adding small, additive, read-only ones (documented per-section).
- **Status:** Added Phase F.2.

---

## 1. Booking UX Philosophy

The customer journey is one continuous decision funnel: **Search → Compare → Decide → Book → Confirm → Track**. Every screen in this phase was built to answer one question — *what is the next obvious action?* — rather than presenting the customer with parallel, competing choices.

Concretely this meant:
- **One primary CTA per screen.** The Experience Detail Page's booking summary card is the only prominent "Book Now" surface — it stays `sticky` on desktop precisely so it's never more than a glance away, without needing a second CTA elsewhere.
- **Progress is always visible, never assumed.** `BookingStepsIndicator` (Experience → Book → Confirmation) appears on the Book and Confirmation pages so a customer always knows where they are and what's left.
- **The journey never dead-ends.** Confirmation offers exactly two forward paths — view the booking, or keep exploring — not a bare "OK."

## 2. Customer Journey (as built)

```
/services (Search) → /services/[id] (Detail) → /services/[id]/book (Book)
   → /bookings/[id]/confirmation (Confirm) → /bookings/[id] (Track, w/ real Timeline)
   ↕
/bookings (My Bookings — Upcoming/Past/Search)
```

Every arrow above is a real, already-existing route — this phase did not introduce a new page or a new server action anywhere in the flow. It restructured what each page shows and how it flows into the next.

## 3. Search Principles

- **The URL is the state machine.** Every filter (`q`, `minPrice`, `maxPrice`, `providerId`, `sort`) lives in the query string, not client state — shareable, bookmarkable, back-button-correct. `ServiceFilters` remains a plain `<form method="get">`, unchanged in architecture from before this phase.
- **Active filters are visible and removable.** A new "active filters" chip row (each chip a real link removing exactly that one param) closes a real gap: previously a customer had no way to see or clear what they'd filtered by except manually editing the form again.
- **No control is built for a field that doesn't exist.** Date and passenger-count pickers were deliberately **not** added to site-wide search: `Service`/`Provider` have no date-availability-scoped search query and no location field (confirmed in `get-services.ts`'s own note, unchanged this phase). Building disabled or fake controls for these would be worse than omitting them — the same principle this codebase already applied to the Category/Governorate filters. Date and seat selection correctly happen once, at the real booking step, where `getAvailableSlots()` provides real per-slot capacity.

## 4. Booking Principles

- **Reduce the path to zero unnecessary steps.** The booking form was already a single real step (pick a slot, pick seats, confirm) — Phase F.2 did not invent a multi-step wizard around it (that would add clicks, not remove them). Instead it added a *presentational* progress indicator so the customer understands this is step 2 of 3 in the larger journey, plus a "back to experience" link for easy course correction.
- **Never fabricate data to fill a section.** The Detail Page's "Duration" and "Meeting Point" fields show an honest "Not specified by provider" rather than invented copy — no such fields exist on `Service` today. "What's Included/Excluded" sections were omitted entirely rather than populated with generic placeholder bullets, since even a "—" fallback would misrepresent structured data that doesn't exist. Reviews render a real, honest empty state — no review was invented, and no new query was written (`Review`/`Rating` exist in schema but are unwired by any app code, unchanged this phase). Map is a static, non-interactive placeholder — no external map provider was integrated, per explicit instruction.
- **Reuse real data wherever it already exists.** The single highest-value change this phase: the booking detail page's **Booking Timeline** now renders `getBookingTimeline()` — Phase E.1's own `BookingStatusEvent` query, built for the Booking Lifecycle Engine but never surfaced in any UI until now. Zero new data, zero schema change — just a real feature finally shown to the customer who already benefits from it happening under the hood.
- **Honest, not dead, actions.** Download Contract / Share / Contact Provider on the Confirmation page render as clearly disabled, muted controls (`aria-disabled`, same visual treatment `AppSidebar` already uses for Settings/Saved) rather than either fabricated working buttons or a functioning-looking button that does nothing when clicked.

## 5. My Bookings — Upcoming vs. Past

`getMyBookings()` gained two small, additive parameters this phase:
- `search` — filters by service name (identical JSON-path strategy already used by `get-provider-bookings.ts`, not a new pattern).
- `when: "upcoming" | "past"` — a real filter over the existing `status` column (`CREATED`/`CONFIRMED`/`IN_PROGRESS` = upcoming, `COMPLETED`/`CANCELLED`/`DISPUTED` = past), not a new field.

The Upcoming/Past/All segment is deliberately **plain links styled like tabs**, not the interactive `Tabs` primitive — `Tabs` owns client-side state, which would break the URL-driven, shareable-filter pattern every list page in this app already relies on. Each booking card also gained a compact `BookingStatusProgress` bar (current status only, no per-row timeline query — avoiding an N+1 against `BookingStatusEvent`).

## 6. Provider Presentation

`ProviderProfileCard` shows real fields only: `businessName`, `businessDescription`, an initial-letter avatar (no logo field exists — an honest avatar beats a fabricated photo), a "Verified Provider" badge derived from the real `ProviderStatus.APPROVED` gate (not a separate invented flag), and a real published-services count (`getProviderPublishedServicesCount()`, one cheap added `count()` query). "Contact Provider" is an honestly disabled action — no messaging system exists.

## 7. Mobile Considerations

- Every touched page was verified at 375px width with zero horizontal overflow (`scrollWidth === clientWidth`, checked directly in the DOM, not assumed from responsive classes alone).
- The Detail Page's sticky booking summary is sticky only at `lg:` and above (`lg:sticky lg:top-24`) — on mobile it flows naturally below the content instead of permanently occupying viewport height on a small screen.
- The active-filter chips row and the Upcoming/Past/Search bar both wrap (`flex-wrap`, `flex-col sm:flex-row`) rather than overflowing or truncating on narrow viewports.

## 8. Accessibility Notes

- All new interactive controls carry real `aria-label`/`aria-selected`/`aria-disabled` as appropriate: the carousel's prev/next/dot controls, the Upcoming/Past/All tab-styled links (`role="tab"`, `aria-selected`), the honestly-disabled Download/Share/Contact/Contact-Provider buttons.
- Every new input reuses the same `focus:ring-2 focus:ring-primary/20` focus-visible treatment established in Phase F.1's forms audit — no new control shipped without one.
- `FadeIn` and `SuccessCheck` (the two new motion components) rely on `globals.css`'s existing blanket `prefers-reduced-motion` override — no separate reduced-motion handling was written, none was needed.
- The FAQ accordion uses native `<details>`/`<summary>` — keyboard-operable and screen-reader-announced with zero custom ARIA wiring required.

## 9. Deliberately Deferred / Out of Scope

- **Lighthouse re-scoring:** this phase changed JSX structure and added small additive queries, not bundle-affecting dependencies or render-blocking assets — the Phase F.1 Lighthouse baseline was not expected to move and was not re-run.
- **Full translation of the six non-real-translated locales** (`cs`/`de`/`fr`/`it`/`pl`/`ru`): pre-existing debt (confirmed present before this phase, across every namespace, not introduced by it). New keys were added to all 8 locales with byte-identical structure — real English/Arabic text for the two real-translated locales, the exact same `"[xx] key — not yet translated"` placeholder convention already used for every other key in those six files.
- **Real review/map data:** requires a future, explicit schema and product decision (a `Review` query pipeline, a location field, a map provider choice) — none made here, per explicit instruction.
