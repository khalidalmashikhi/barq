# BARQ Production Smoke Test Guide

- **Purpose:** The exact manual sequence a human runs against a real deployed instance to confirm the critical paths genuinely work — not a substitute for automated tests, a post-deploy sanity pass. Every step below names a real route/action that exists in this repository today; nothing here describes a feature that doesn't exist.
- **Scope:** Customer, Provider, and Admin manual smoke sequences.
- **Status:** Added — Go-Live Preparation phase.
- **When to run:** After every production deploy (§1 of `PRODUCTION_RUNBOOK.md`), and after every rollback (§7 of the same).
- **Prerequisite:** A real test phone number the configured OTP provider can actually deliver to, and (if exercising Provider/Admin paths) a Provider account already approved and an Admin account already provisioned in the target environment.

---

## Customer Sequence

1. **Login** — Visit `/login`, enter the test phone number, receive and enter the real OTP code (not the console dev code — confirm the deployed instance is not using the console provider at all, per `RELEASE_CHECKLIST.md`'s OTP Verification section). Confirm redirect to `/dashboard` on success.
2. **Browse** — From the homepage, navigate to `/services`. Confirm listings render, filters apply, and pagination works. Open one Service Detail page (`/services/[id]`) and confirm price, provider name, and (if any) rating/reviews render correctly.
3. **Booking** — From a Service Detail page, start a booking (`/services/[id]/book`). Select an available slot if the service has one, submit, and confirm redirect to `/bookings/[id]/confirmation` with the new booking's real details shown (not a placeholder).
4. **Payment visibility** — From `/payments`, confirm the new booking's payment state renders honestly. With `PAYMENT_PROVIDER=NONE` (the expected launch configuration), confirm this correctly shows an `INITIATED`-shaped state, never a fabricated "paid" claim.
5. **Review** — This step requires a `COMPLETED` booking, which a fresh booking won't be immediately. If a pre-existing completed test booking exists in the target environment, submit a review from `/reviews` (or the booking detail page) and confirm it saves and later appears under "Reviews Given." Otherwise, note this step as deferred to a later smoke pass once a completed booking exists, rather than skipping it silently.
6. **Share** — From a Service Detail page or the booking confirmation page, use the Share button and confirm the produced/copied URL resolves to the real production domain (see `RELEASE_CHECKLIST.md`'s SEO Verification section).
7. **Logout / re-login** — Confirm the session persists across a page reload, and that logging out and back in works cleanly.

## Provider Sequence

*(Requires a Provider test account already `APPROVED` in the target environment — provider approval itself is an Admin action, tested separately below.)*

1. **Dashboard** — Log in as the Provider test account, confirm redirect to the Provider dashboard (`/provider`). Confirm KPI cards, recent bookings, and review summary render with real numbers (zero is a valid, honest number — not an error).
2. **Bookings** — Visit `/provider/bookings`. Confirm the list renders and filtering by status works. Open one booking's detail page (`/provider/bookings/[id]`) and confirm the full timeline renders. If a `PENDING_PROVIDER` booking exists, exercise Accept/Reject and confirm the status transition reflects correctly afterward.
3. **Earnings** — Visit `/provider/earnings`. Confirm the earnings breakdown renders against real completed/captured bookings for this provider (zero is valid if none exist yet in the target environment).
4. **Payments** — Visit `/provider/payments`. Confirm payment records tied to this provider's bookings render, and that the Payments-to-Earnings cross-link works.

## Admin Sequence

*(Requires an Admin test account already provisioned in the target environment.)*

1. **Dashboard** — Log in as the Admin test account, confirm redirect to the admin overview. Confirm the Database Connectivity indicator (which reuses `checkDatabaseHealth()` — the same check `/api/health` uses) shows connected.
2. **Users** — Confirm whichever customer/staff-facing admin views exist today render without error — this platform's admin surface is intentionally minimal (provider approval is the one real, state-changing admin capability today; do not expect a full user-management console that hasn't been built).
3. **Bookings** — Visit `/admin` booking-related views if present, confirm real booking records render.
4. **Providers** — Visit `/admin/providers`. Confirm the pending-provider queue renders, and — if a genuine test application exists in the target environment — exercise the real Approve action and confirm the provider's status actually transitions to `APPROVED`.
5. **Payments** — Visit `/admin/payments`. Confirm the payment overview metrics render against real data (zero valid if `PAYMENT_PROVIDER=NONE` and no captures have ever occurred).

---

## What This Guide Deliberately Does Not Cover

- Any flow requiring `PAYMENT_PROVIDER=STRIPE` — out of scope for every phase through Go-Live Preparation; do not attempt to smoke-test real payment capture against production.
- Any flow requiring Mobile, AI, Coupons, Campaigns, or Referrals — none of these exist yet.
- Automated regression coverage — this guide is a manual, post-deploy sanity pass; `npm run test` (1182+ tests as of this phase) is the actual regression suite, run pre-deploy per `PRODUCTION_RUNBOOK.md` §1.

## Related Documents
- `PRODUCTION_RUNBOOK.md` §5 — when this guide is run in the deployment sequence
- `docs/11-release/RELEASE_CHECKLIST.md` — the broader Go-Live checklist this guide's final item belongs to
- `PRODUCTION_READINESS.md` §2 step 7 — the earlier, shorter smoke-test mention this guide replaces with full detail
