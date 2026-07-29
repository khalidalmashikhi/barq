# 08 — Pricing & Commissions

## Current state

**Pricing** (`Price` model): `amount` (Decimal 12,2), `currency`, `status` (`ACTIVE`/`SUPERSEDED`) — immutable, append-only (a price change creates a new row rather than mutating the old one). Entirely provider-set today; no admin control mode, no approval step, no request-for-quote flow.

**Commissions** (`Commission` model): `tier` (`CommissionTier` enum: `TIER_12`/`TIER_10`/`TIER_8` — fixed percentages only), `status` (`ACTIVE`/`SUPERSEDED`), assigned per-provider. No fixed-fee, hybrid, zero, or manually-agreed commission concept exists.

**What's financially tracked today**: gross `amount`/`currency` on `Price`/`Payment`; a confirmation-time snapshot of `priceSnapshotAmount`/`commissionSnapshotAmount`/`commissionSnapshotTier` on `Booking` (so a later commission-rate change never silently reprices a past booking); payment capture/refund state (`PaymentStatus`: `INITIATED`/`CAPTURED`/`REFUNDED_PARTIAL`/`REFUNDED_FULL`/`FAILED`); ledger movement (`WalletTransaction`, immutable, with a `direction`/`cause` shape).

**What's not tracked anywhere today**: discounts, taxes/VAT as distinct fields, an explicit "net amount after commission" field, or a settlement/transfer-to-bank-account status. No bank-account field exists on `Provider` at all — so a payout destination isn't even modelable in the schema yet.

## Target model

**Pricing control modes**: admin-controlled, provider-controlled, both-with-approval, or request-for-quote — configurable per category/service.

**Commission models**: percentage, fixed amount, percentage plus fixed amount, zero commission, or manually agreed commission — settable per category, subcategory, service, or individual provider (today: per-provider only, 3 fixed percentages).

**Full financial breakdown per transaction, distinguishing**:
- Gross booking amount
- Discounts
- Taxes
- BARQ commission
- Provider net amount
- Paid amount
- Outstanding amount
- Settlement status
- Transfer status

## Design note

This is a genuine schema-design undertaking (new fields on `Booking`/`Payment`, likely a new `ProviderPayoutAccount` or similar model for settlement destination, possibly a generalized `CommissionRule` model to replace the fixed 3-tier enum) — not a small extension. Per this phase's own scope, no implementation begins until separately scoped and approved; see `../plans/ROADMAP.md`.

## Related registry entries

BR-005, BR-014, BR-015 in `16-BUSINESS-RULES.md`; `Pricing`, `Commission`, `Settlement`, `Payment` entities in `15-DATA-DICTIONARY.md`.
