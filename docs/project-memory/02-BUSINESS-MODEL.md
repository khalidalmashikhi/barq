# 02 — Business Model

Full architectural business-model documentation lives at `docs/01-business/BUSINESS_MODEL.md` (Approved v1.0 — Locked) — this file summarizes it and captures the newer target direction from `03-PRODUCT-REQUIREMENTS.md` that extends it. Do not treat this file as superseding the Locked document; treat it as the bridge between that document and where the product is now headed.

## Current, real business model

- BARQ is a marketplace connecting tourists with Omani providers (accommodation, transport, restaurants, activities).
- Providers apply (`applyAsProvider`), an admin approves (`approveProvider`) — the only gate that exists today.
- Commission is a **fixed 3-tier percentage** (`TIER_12`/`TIER_10`/`TIER_8` on the `Commission` model) — assigned per provider, not per category/subcategory/service, and not configurable beyond those three values.
- Pricing is entirely provider-set (`Price` model: amount, currency, ACTIVE/SUPERSEDED status) — no admin pricing control, no request-for-quote flow.
- Financial tracking exists for gross amount, a booking-time snapshot of price+commission, payment capture/refund, and wallet ledger movement — see `01-CURRENT-STATE.md` for exactly what is and isn't tracked.

## Target business model (not yet built)

- **Commission control granularity**: per category, subcategory, service, or individual provider (today: per-provider only, and only 3 fixed values).
- **Commission models**: percentage, fixed amount, percentage plus fixed amount, zero commission, or manually agreed commission (today: fixed percentage only, 3 tiers).
- **Pricing control modes**: admin-controlled, provider-controlled, both-with-approval, or request-for-quote (today: provider-controlled only, no approval step, no RFQ).
- **Full financial breakdown per transaction**: gross booking amount, discounts, taxes, BARQ commission, provider net amount, paid amount, outstanding amount, settlement status, and transfer status (today: several of these fields don't exist yet — see `08-PRICING-COMMISSIONS.md` for the detailed gap).

## Where this is headed

See `../plans/ROADMAP.md` for sequencing — a real Financial and Commission Engine (planned engine #7) is a substantial schema and workflow undertaking, and per this phase's own scope, no implementation begins until it is separately scoped and approved.
