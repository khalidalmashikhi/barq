# BARQ — Code Freeze Checklist

Produced by the Code Freeze / Operational Validation phase, immediately following the Release Candidate Approved with Operational Conditions verdict. This document is the authoritative record of the repository's exact state at freeze time and the single source of truth for migration-history risk — it corrects two pre-existing, factually incorrect claims found in [`PRODUCTION_RUNBOOK.md`](../07-infrastructure/PRODUCTION_RUNBOOK.md) and [`PRODUCTION_READINESS.md`](../07-infrastructure/PRODUCTION_READINESS.md) (both now updated to point here).

---

## 1. Git Release State (verified fresh this phase)

- **Branch**: `main`, tracking `origin/main`.
- **Local commit**: `ad4aa84` ("feat(i18n): complete Phase A.5 next-intl migration") — matches `origin/main`, no unpushed commits.
- **Tags**: exactly one, `v0.1-foundation` — pointing at an early commit, not updated to reflect any work since. **No release tag exists for the current, Release-Candidate-approved state.** Creating one is a manual action (see §4) — not done automatically by this phase, since tagging is a deliberate release action, not a documentation one.
- **Other local branches** (not part of this release, informational only): `feat/availability-engine`, `feat/dashboard-data`, `feat/full-i18n`, `feat/services-marketplace`.
- **Working tree**: substantial uncommitted work — every phase since commit `ad4aa84` (Phase A remediation, both audit rounds, the provider-deactivation gap closure, the Release Candidate documents, and this Code Freeze phase's own corrections/additions) remains **uncommitted**, consistent with this entire engagement's standing "do not commit / do not push unless explicitly instructed" constraint. `git status --short` shows a large set of modified (`M`), deleted (`D` — legacy pre-reorganization doc paths, superseded by content that now lives elsewhere, not lost), and untracked (`??`) entries.
- **No destructive `git` operation has been run** — nothing has been reset, force-pushed, or discarded.

## 2. Corrected Prisma Migration History Audit

**This corrects a factual error.** Prior documentation (`PRODUCTION_RUNBOOK.md` §2, `PRODUCTION_READINESS.md` §6) stated "every migration is additive" / "a genuinely destructive migration has never shipped." This was **not verified against the actual migration SQL** when written — this phase re-audited all 19 migration files directly (`grep` for `DROP`/`RENAME`/`ALTER COLUMN`/`TRUNCATE`/`DELETE FROM`, then full-file read of every match) and found four that are not purely additive.

| # | Migration | Date | Classification | What it actually does |
|---|---|---|---|---|
| 1 | `20260706191113_init` | 07-06 | Additive | Initial schema |
| 2 | `20260707164739_add_phone_number_verified` | 07-07 | Additive | New column |
| 3 | `20260707191929_fix_better_auth_id_format` | 07-07 | **Structural, not data-loss** | Drops and recreates the primary-key constraint on `accounts`/`sessions`/`verifications` while changing `id`'s column type to `TEXT`. Prisma's own generated warning: "If it partially fails, the table could be left without primary key constraint." Postgres runs each migration file in a single transaction, so a partial failure rolls back entirely — not a real crash-safety risk — but this is a genuine structural change, not a simple addition. |
| 4 | `20260707195906_separate_better_auth_user` | 07-07 | **Destructive — real data loss on a populated table** | `DROP COLUMN "userId"` on `accounts` and `sessions`. Prisma's own generated warning: "All the data in the column will be lost." Also adds `authUserId` as `NOT NULL` with no default ("not possible if the table is not empty"). |
| 5 | `20260707200913_align_better_auth_user_field_names` | 07-07 | **Destructive — real data loss on a populated table** | `DROP COLUMN "authUserId"` on `accounts` and `sessions` (the column migration #4 had just added), replacing it with `userId` — the same data-loss warning pattern as #4. Together, #4 and #5 are same-day churn while the Better Auth identity architecture (`auth_users` table split) was being stabilized. |
| 6 | `20260710200000_availability_capacity_model` | 07-10 | **Data-transforming, not a drop** | Hand-authored (its own header explicitly states it was written without access to a real database or `prisma migrate diff` — never machine-verified). Drops a foreign key defensively (`IF EXISTS`, safe). Removes the `BOOKED` value from `AvailabilitySlotState` via the standard Postgres rename-recreate-convert pattern, with a `CASE` mapping that **silently rewrites every existing `BOOKED` row to `OPEN`**. This is a real, intentional semantic data change on any already-existing row — not a column drop, but not "purely additive" either. |
| 7–19 | Every migration from `20260720070426_add_notification_read_state` through `20260724223401_add_payment_provider_reference` (13 migrations) | 07-20 → 07-24 | Additive | Confirmed via the same grep + full-file check: new tables, new columns, new indexes only. One (`20260722164615_phase_5_2_audit_log_and_indexes`) drops two indexes (`invoices_invoiceNumber_idx`, `sessions_token_idx`) — structural only, zero data loss, trivially rebuildable. |

**Why this doesn't block the Release Candidate or this Code Freeze**: migrations #3–#6 all shipped and ran on **2026-07-07 and 2026-07-10**, during the Better Auth identity-architecture stabilization that happened before this application had any real user-facing data (well before the first customer/provider-facing phase). Any environment migrated since has already absorbed them with zero rows in the affected columns at the time. **For this specific, first-ever production deployment against a brand-new, empty database**, running `prisma migrate deploy` applies all 19 migrations in sequence starting from zero rows everywhere — every "data will be lost" warning is moot because there is no data yet to lose.

**What this correction actually changes**: the blanket claim "no destructive migration has ever shipped, so none needs its own rollback plan" is false and must never again be used to justify skipping a migration-safety review for a *future* migration once production has real rows. Any new migration proposed after this deployment's data exists must be individually reviewed for `DROP COLUMN`/`DROP TABLE`/enum-value removal/`NOT NULL` additions before merge — this repository has already shipped exactly this category of migration once (in its early architecture-stabilization period) and could again if a reviewer isn't specifically watching for it.

**Corrective actions taken this phase**: `PRODUCTION_RUNBOOK.md` §2 and `PRODUCTION_READINESS.md` §6 have both been updated to point here rather than repeat the disproven blanket claim. No other document made this specific factual error (`RELEASE_CHECKLIST.md`'s "no destructive migrations across F.1–F.5" is a narrower, phase-scoped claim — F.1–F.5 were UI/design phases with no schema migrations at all, so that specific claim remains accurate and was left unchanged).

## 3. Quality Gate Re-Confirmation

Re-affirmed from the Release Candidate phase, not re-run redundantly since no application code has changed since: TypeScript clean, ESLint clean, 1,345/1,345 tests passing across 198 files, production build succeeds. See [`RELEASE_CANDIDATE_SUMMARY.md`](RELEASE_CANDIDATE_SUMMARY.md) for the exact figures.

## 4. Code Freeze Checklist (exact items)

- [x] Confirm `main` matches `origin/main` — no unpushed local commits exist that would surprise a deploy.
- [x] Confirm no uncommitted change touches `prisma/schema.prisma` beyond what's already accounted for in the Release Candidate's own diff (verified — this Code Freeze phase itself made zero schema changes, per its own constraint).
- [x] Re-audit full Prisma migration history for destructive operations — done, §2 above; prior false claims corrected.
- [ ] **Manual, owner action**: tag the current approved state (e.g. `v1.0.0-rc1`) once the branch is in the exact state intended for staging/production deployment — not done automatically by this phase, since creating a tag is a deliberate release action.
- [ ] **Manual, owner action**: decide and communicate the actual code-freeze enforcement mechanism (branch protection rule, merge-freeze announcement, or simply team discipline) — this document records the *state*, it does not itself lock the repository.
- [x] Confirm no destructive `git` command has been run against this repository during this phase or any phase this session.
