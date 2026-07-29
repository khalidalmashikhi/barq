# BARQ Provider Experience — Operating System for Tourism Providers

- **Purpose:** Documents the presentation-layer work delivered in Phase F.3 (Provider Experience & Marketplace Excellence) — the Provider Dashboard, KPIs, navigation, service/availability/booking management, notifications, and the principles behind each decision. Companion to `docs/10-design/DESIGN_SYSTEM.md` (tokens/primitives) and `docs/10-design/CUSTOMER_EXPERIENCE.md` (the equivalent document for the customer-facing side).
- **Scope:** Provider Dashboard, KPI Cards, Provider Navigation, Provider Services, Availability Management, Booking Management, Provider Notifications, empty/loading/error states, accessibility, responsive, performance, visual polish.
- **Out of Scope:** Business logic, schema, Auth/OTP, Booking Lifecycle, Contract Engine, Signature Engine, RBAC, existing APIs — none were touched this phase; every change below is presentation-layer, reusing existing queries or adding small, additive, read-only ones (documented per-section, exactly as Phase F.2 did for the customer side).
- **Status:** Added Phase F.3.

---

## 1. Provider UX Philosophy

A provider is running a business, not browsing one. Every screen in this phase was built around the Product Vision's own test: closer to a Host dashboard or a Stripe/Shopify admin than a marketing surface. Concretely:

- **Operational information first, decoration second.** The redesigned Dashboard leads with what needs attention *today* (a pending-confirmations alert, today's/upcoming bookings) before any summary statistic.
- **Real numbers or an honest dash — never a guess.** Every KPI, rate, and revenue figure traces to a real Prisma aggregate. Where no data exists to compute a rate (zero bookings, zero upcoming capacity), the UI shows "—", never a misleading "0%".
- **No fake controls.** Two goals in this phase (Service Management: Create/Edit/Publish/Pause/Archive; Booking Management: an implied confirm/reject action) describe functionality that does not exist anywhere in this codebase yet — confirmed by direct search before writing any UI, not assumed. Rather than build non-functional buttons, both pages carry a single, honest, non-interactive message explaining the gap.

## 2. Dashboard Hierarchy

Top to bottom, in the order a provider should actually care about it:

1. **Welcome header** (unchanged gradient band from Phase F.1's completion pass).
2. **Pending Confirmations alert** — shown only when real `pendingConfirmationsCount` (bookings in `CREATED` status) is greater than zero, with a real link into a pre-filtered Bookings view (`?status=CREATED`).
3. **KPI row** ("Business at a Glance") — the five headline numbers (§3).
4. **Secondary stat row** — draft services, open slots, upcoming occupancy, active bookings.
5. **Today's Bookings / Upcoming Bookings** — two real, slot-time-ordered preview lists (new this phase — see §2.1).
6. **Service Performance** — real booking-count ranking per service.
7. **Quick Actions** — real navigation shortcuts only (Services/Bookings/Availability/Notifications); deliberately no "Create Service" shortcut, since no service-creation UI exists anywhere to link to.
8. **Recent Activity** — unchanged, createdAt-ordered feed from Phase 1a.

### 2.1 A new real data path

`getProviderOverview()` gained `pendingConfirmationsCount`, `todaysBookings`, and `upcomingBookings` — small, additive `findMany`/`count` calls reusing the exact same WHERE clauses the existing counts already used, just also returning rows (not only totals). No new table, no new business rule — the same data, shown two ways.

## 3. KPI Philosophy

`getProviderMetrics()` (new module, `src/lib/provider/queries/get-provider-metrics.ts`) computes exactly five numbers, all from real aggregates:

| KPI | Real source |
|---|---|
| Total Bookings | `Booking.groupBy(status)`, summed |
| Active Services | `publishedServicesCount` (already existed) |
| Completion Rate | completed ÷ total bookings |
| Cancellation Rate | cancelled ÷ total bookings |
| Revenue (Completed) | `SUM(Booking.priceSnapshotAmount)` for COMPLETED bookings, grouped by currency |

**Revenue source, deliberately not Wallet/WalletTransaction:** those tables exist in the schema but are populated only by the (unbuilt, out-of-scope) Payments context — summing an empty ledger would show a confusingly-always-zero Revenue for every provider. A completed booking's own price snapshot is real, already-stored, per-provider data captured at confirmation time (`Booking.priceSnapshotAmount`'s own schema comment: "Price snapshot at confirmation — fixed per DOMAIN_MODEL invariant"). Multi-currency totals are never silently summed together — each currency gets its own line.

**Occupancy Rate** (secondary row) is `bookedCount ÷ capacity` across the provider's upcoming, non-cancelled `Availability` rows — real, but rendered as "—" when there is no upcoming capacity to divide by, not a fabricated 0%.

**No chart library was added.** No charting dependency existed in this project before this phase, and the brief's own "Charts (only if already available)" clause means none should be introduced solely for this round. KPI cards, an occupancy progress bar, and a ranked Top Services list are this phase's answer to "Analytics Experience" — real progress indicators and summaries, no fabricated visualizations.

## 4. Navigation

The one real, structural gap found while reviewing Provider navigation: `AppSidebar` is `hidden md:flex` with **no mobile equivalent at all** — below `md`, a Provider (or Customer, since `AppShell` is shared) had zero navigation, only whatever the current page happened to link to. Fixed with a new `AppMobileNav` component (drawer + hamburger trigger in `AppTopBar`), mirroring the public site's own `MobileNav` pattern but built for the authenticated shell's `AppNavItem` contract. Because `AppShell`/`AppTopBar` are shared components, this fix benefits the Customer dashboard too — not scope creep, since no Customer-specific page was touched, only the shell both roles already share.

## 5. Service Management UX

Real improvements: labeled filter fields, removable active-filter chips (mirroring the Phase F.2 customer-facing pattern), keyboard focus rings on every row link.

**Honestly out of scope:** Create, Edit, Publish, Pause, and Archive actions. Confirmed before writing any UI that no such server action exists anywhere in this codebase (a direct grep for `updateServiceStatus`/`publishService`/`pauseService`/`archiveService`/`prisma.service.update` — and separately for service creation — found nothing). The Service Detail page now carries one honest, non-interactive `Alert` stating this plainly, replacing silence with a clear status message — not a disabled button suite pretending five features are "almost ready."

## 6. Booking Management UX

- **Search + status filter**, redesigned with the same labeled-field/chip pattern as Services.
- **Timeline visibility**: `BookingStatusProgress` (built Phase F.2 for the customer's My Bookings list, fully generic) is reused here unchanged — no duplicate component was written.
- **Priority indicators**: a `CREATED` booking — genuinely the one status a provider must act on — gets a real "Needs action" badge and an accent-colored border. Derived entirely from the existing `status` field, not a new one.
- **Customer information**: unchanged, deliberately — no name/phone/email is shown (no such field exists on `User`/`Customer`, a phone-only-auth product decision predating this phase).
- **Actions hierarchy**: no confirm/reject/complete button was added. `cancelBooking()` is customer-only (`requireCustomer()`, `actorType` hardcoded `"CUSTOMER"`) — there is no provider-side booking mutation anywhere to wire a button to.

## 7. Availability Management

No calendar-grid component exists anywhere in this codebase, and building one from scratch was judged out of this phase's presentation-only scope. Instead, the already-fetched, already date-ordered slots are grouped by their real calendar day — a calendar-*adjacent* list, the honest middle ground the goal's own "otherwise improve list presentation" clause allows. Each row now shows a real capacity bar (`bookedCount`/`capacity`, both already-fetched fields) alongside the existing remaining-seats figure, turning one number into a genuinely more legible picture of how full a slot is.

## 8. Notification UX

Real, data-derived improvements only: notifications are grouped by their own real date (mirroring the Availability page's own grouping technique), and each gets an icon derived from the real, already-existing nullable `causingBookingId` field (booking-related vs. general) — not a fabricated priority tier, which no field in this schema supports. Unread/read visual hierarchy (tinted card, dot, bold text) is unchanged from Phase D.1.

## 9. Accessibility Notes

- Every new interactive element (KPI cards are non-interactive by design; booking-preview "View all" links, Top Services links, filter chips, mobile nav items) carries a real `focus-visible:ring-2` treatment — none shipped without one.
- The mobile nav drawer uses `role="dialog"` / `aria-modal="true"`, a labeled close button, and traps focus within a full-screen overlay, mirroring the public site's own accessible drawer pattern.
- The "Needs action" priority badge and pending-confirmations alert are visual *and* textual (never color-only) — a screen reader gets the same "needs action" information a sighted user gets from the accent border.

## 10. Responsive Strategy

Live-verified at 1280px (desktop) and 375px (mobile) with a real authenticated Provider session, plus Arabic RTL — zero horizontal overflow at any of the three (`scrollWidth === clientWidth`, checked directly in the DOM). The KPI row degrades from 5 columns (`xl`) to 3 (`lg`) to 2 (default) rather than overflowing or wrapping awkwardly; the two-column preview/summary sections stack to one column below `lg`.

## 11. Deliberately Deferred / Out of Scope

- **Service Create/Edit/Publish/Pause/Archive** and **Booking Confirm/Reject** — no backend mutation exists for any of these; each gets an honest status message, not a working button (see §5, §6).
- **Real chart visualizations** — no charting library exists in this project; none was added this phase (see §3).
- **A calendar-grid view for Availability** — no such component exists; a date-grouped list was built instead (see §7).
- **Six-locale translation** (`cs`/`de`/`fr`/`it`/`pl`/`ru`) for Phase F.3's own new keys: translated to real text for all six, not left as placeholders — every one of the 26 new `provider.json` keys and 2 new `common.json` keys (mobile-nav aria labels) got a real, human-quality translation, verified with a zero-placeholder grep sweep afterward. The *pre-existing* translation debt in those same files (every key that existed before this phase) is untouched — a separate, whole-app gap predating F.3, not this phase's to fix.
