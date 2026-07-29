# 11 — Security Policy

Full architectural security documentation lives at `docs/05-trust-and-compliance/SECURITY.md` (Approved v1.0 — Locked) and ADR-0008 (AI Agent Boundaries) — this file states the operating boundary in one place for quick reference and ties it to the "admin-controlled where safe" principle running through every other file in this directory.

## What must always stay code-controlled

- **Authentication** — Better Auth phone+OTP flow (`src/lib/auth/`), session handling, RBAC role checks (`src/lib/auth/rbac.ts`). Never move a permission check into admin-editable configuration.
- **Payment integrity** — payment capture/refund state transitions, commission calculation at the point a booking is confirmed (snapshotted, never recalculated retroactively from a later-changed rule).
- **Permission enforcement** — the 4 fixed roles (Customer/Provider/Staff/Admin) and their `require*()` gates. A future, more granular Permission Engine (planned engine #15, paired with the Audit Trail) may extend this, but the enforcement mechanism itself stays code, never purely data-driven in a way that could be misconfigured into an authorization bypass.
- **Audit logging** — `AuditLog`/`BookingStatusEvent`/`BookingContractEvent` writes happen inside the same transaction as the mutation they describe (established Phase 5.2 pattern) — this atomicity guarantee must never be relaxed for the sake of making an engine "more configurable."

## What may become admin-controlled, where safe

- Categories, subcategories, and their visibility state.
- Pricing models and commission rules (the *values*, never the *calculation integrity* — e.g., an admin may set "10% commission for category X," but the code that applies that rate to a real transaction and snapshots it stays code-controlled).
- Translations (with the AI-assisted-workflow review-state gate for provider content — see `09-TRANSLATION-I18N.md`).
- Homepage/CMS content.
- Feature flags.
- Notification trigger rules.
- Provider/service form fields (via a future Form Builder), as long as submitted data still passes through code-controlled validation before being trusted.

## AI Agent Boundaries (ADR-0008) — binding on any future AI Center work

An AI agent (planned engine #14) must never, autonomously:
- Bypass authorization or access the database directly outside its granted API surface.
- Modify financial records or execute payouts.
- Approve providers or finalize contracts.
- Take any action affecting money, trust, or personal data without a human-in-the-loop checkpoint.

Every AI agent action must be universally auditable. These 17 permanent boundaries (see the ADR itself for the full list) apply to any future engine that gives an AI agent write access to anything — they are not negotiable per-feature.

## The dividing line, stated once

If a change would let non-engineering staff alter *what happens* (a category's visibility, a commission percentage, a translation) — that's a good candidate for admin control. If a change would let non-engineering staff alter *whether a security/financial/permission check runs at all* — that must never be admin-controlled, full stop.

## Related registry entries

BR-006, BR-020 in `16-BUSINESS-RULES.md`; the concrete per-role, per-module grid in `20-PERMISSION-MATRIX.md`; the Security row of `22-NON-FUNCTIONAL-REQUIREMENTS.md` for the current-state security posture summary.
