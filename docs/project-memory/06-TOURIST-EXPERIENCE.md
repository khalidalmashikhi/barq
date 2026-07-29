# 06 — Tourist (Customer) Experience

## Current state

A customer today can: browse services (`/services`, with real filters), view a service/provider detail page, book a service (real `Booking` lifecycle with a full state machine — see `docs/08-bookings/BOOKING_LIFECYCLE.md`), receive notifications (Notification Center — list/unread-count/mark-read), and leave a review after completion. Self-service signup auto-provisions a `Customer` profile on first OTP verification (Phase 5.1).

The homepage's "Categories" section is a hardcoded, non-functional 6-item array — browsing by category is not a real, working filter today (see `01-CURRENT-STATE.md`). There is no way to message a provider, open a support ticket, or reach a "ساعدني" channel — none of that exists yet.

## Target state

- **Real category browsing** — once Dynamic Category Management exists, replacing today's decorative 6-item array with a working, admin-managed taxonomy.
- **"ساعدني" support channel** — a BARQ-owned contact point (not a provider's own number) for customer assistance, backed by the currently-schema-only `SupportTicket` model becoming a real feature.
- **In-platform messaging** — booking inquiries and quote requests routed through BARQ, never direct provider contact. See `10-COMMUNICATION-POLICY.md` for the full policy this must satisfy.
- **Request-for-quote flow** — for services where pricing is RFQ-controlled rather than fixed (see `08-PRICING-COMMISSIONS.md`).

## What must not change

The current no-direct-contact-exposure baseline (provider phone/WhatsApp/email never shown to a tourist) is already correct and must be preserved as messaging/support features are built — the new features route communication *through* BARQ, they don't expose a provider's own channels directly.

## Related registry entries

BR-002, BR-003 in `16-BUSINESS-RULES.md`; `SupportTicket`, `Conversation`, `Message` entities in `15-DATA-DICTIONARY.md`.
