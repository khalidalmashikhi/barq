# BARQ — Disaster Recovery Drill

Produced by the Code Freeze / Operational Validation phase. This is a **drill script to run against the isolated staging environment** ([`STAGING_DEPLOYMENT_CHECKLIST.md`](STAGING_DEPLOYMENT_CHECKLIST.md)) — never against production. It exists specifically to close the gap [`PRODUCTION_RUNBOOK.md`](../07-infrastructure/PRODUCTION_RUNBOOK.md) §13 has honestly flagged since the Go-Live Preparation phase: *"No automated database backup or tested restore procedure — the single largest gap between 'documented runbook' and 'genuinely disaster-proof operation.'"* This document is the first real attempt to close that gap with an actual, executable procedure rather than a restated intention.

**Nothing in this document has been executed.** It is the plan an operator runs, with explicit pass/fail criteria, not a record of a drill already performed.

---

## 1. Backup Procedure

1. Confirm the staging database provider's automated backup is enabled (same requirement as [`RELEASE_CANDIDATE_CHECKLIST.md`](RELEASE_CANDIDATE_CHECKLIST.md) §3 — this drill is what actually proves that configuration works, rather than trusting it exists).
2. Immediately before the drill, trigger (or confirm the existence of) one on-demand backup/snapshot of the staging database via the provider's console or CLI. Record the exact backup identifier/timestamp.
3. Record the staging database's exact row counts for every non-trivial table at this moment (`SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname;` or equivalent) — this is the baseline the restore is checked against in §3.
4. Record `npx prisma migrate status` output at this moment — the migration baseline the restore is checked against in §4.

## 2. Restore Procedure

1. Using the provider's own restore mechanism, restore the backup identified in §1 step 2 into a **new, separate scratch database instance** — never restore over the live staging database itself, since that would destroy the very thing you're trying to prove you can recover.
2. Point a throwaway `DATABASE_URL` (a local shell, never committed) at the restored scratch instance.
3. Record the wall-clock time from "restore initiated" to "restore reports complete" — this is the raw input to the RTO measurement in §6.

## 3. Data-Integrity Verification

1. Re-run the same row-count query from §1 step 3 against the restored scratch database. Every table's count must match the baseline exactly (or match what's expected given the backup's timestamp relative to any writes that happened after it was taken — see §5's RPO measurement for how to reason about that gap).
2. Spot-check referential integrity on the restored copy: pick 3 real `Booking` rows and confirm their `customerId`/`providerId`/`serviceId` foreign keys still resolve to real, matching rows — a partial or corrupted restore often breaks joins before it breaks raw row counts.
3. Confirm no table is unexpectedly empty (a `0` row count on a table that had real staging data before the backup is a hard fail, not a soft warning).

## 4. Migration Verification

1. Run `npx prisma migrate status` against the restored scratch database. It must report the exact same applied-migration set as the baseline recorded in §1 step 4 — no migration missing, none unexpectedly pending.
2. Run `npx prisma migrate deploy` against the restored scratch database as a no-op sanity check — it should report "No pending migrations to apply," never attempt to apply anything new (if it does, the restore captured a database mid-migration or from the wrong point in time — investigate before treating the restore as valid).

## 5. Application Smoke Verification

1. Point a throwaway local instance of the application (`DATABASE_URL` → the restored scratch database, every other env var matching staging's own values) at the restored data.
2. Run `GET /api/health` against this throwaway instance — expect `200`/`"status":"ok"`/`"database":"ok"`.
3. Log in as the staging Customer test identity ([`STAGING_DEPLOYMENT_CHECKLIST.md`](STAGING_DEPLOYMENT_CHECKLIST.md) §8) and confirm their pre-existing bookings (if any existed at backup time) render correctly from the restored data — this is the real proof that "restorable" means "the application actually works against it," not just "the database process starts."

## 6. RPO Measurement (Recovery Point Objective)

- **Definition for this drill**: the time gap between the last write the staging database recorded before backup and the timestamp embedded in the backup itself.
- **Measurement**: compare the `createdAt`/`updatedAt` timestamp of the most-recently-modified row (across `Booking`, `BookingStatusEvent`, `Payment` if any exist) at backup time against the backup's own recorded timestamp.
- **Record**: the actual measured gap, in minutes, for this specific drill run — this is provider-dependent (continuous PITR vs. periodic snapshot) and must be measured, not assumed from marketing material.
- **Pass threshold**: gap ≤ 15 minutes if PITR is genuinely enabled; gap ≤ the provider's stated snapshot interval (typically 24h) if only periodic snapshots are configured. Either is acceptable **only if the business has explicitly accepted that RPO window** — this drill surfaces the real number; accepting it is a business decision, not a technical one this document makes on the owner's behalf.

## 7. RTO Measurement (Recovery Time Objective)

- **Definition for this drill**: wall-clock time from "an operator decides a restore is needed" to "the application smoke verification in §5 passes."
- **Measurement**: sum of §2 step 3's raw restore time, plus the time to point a working application instance at the restored database and complete §5's three checks.
- **Record**: the actual measured total, in minutes, for this specific drill run.
- **Pass threshold**: ≤ 60 minutes end-to-end for this drill to be considered a genuine operational capability, not merely a theoretical one. If the measured time exceeds this, that is itself the drill's most important finding — it means the current documented rollback/recovery plan ([`PRODUCTION_RUNBOOK.md`](../07-infrastructure/PRODUCTION_RUNBOOK.md) §6–§8) overstates how fast a real recovery would actually be.

## 8. Pass/Fail Criteria

| Check | Pass Condition |
|---|---|
| Backup exists and is identifiable | A specific backup ID/timestamp was recorded in §1 |
| Restore completes | §2 completes without provider-side error, to a *separate* scratch instance |
| Data integrity | Every §3 check passes — no row-count mismatch, no broken foreign key, no unexpectedly empty table |
| Migration state | §4's `migrate status` matches baseline exactly; `migrate deploy` is a genuine no-op |
| Application smoke | §5's three checks all pass against the restored data |
| RPO | A real number was measured and recorded (§6) — pass/fail on the *threshold* is a business decision on top of this measurement |
| RTO | ≤ 60 minutes measured end-to-end (§7) |

**Overall drill verdict**: **Pass** only if every row above passes. **Conditional Pass** if data integrity and migration verification pass but RTO exceeds 60 minutes (recovery works, but slower than desired — an operational tuning problem, not a correctness problem). **Fail** if any data-integrity or application-smoke check fails, or if no restore could be completed at all.

## Related Documents
- [`PRODUCTION_RUNBOOK.md`](../07-infrastructure/PRODUCTION_RUNBOOK.md) §6–§8 — the rollback/recovery procedure this drill validates
- [`RELEASE_CANDIDATE_CHECKLIST.md`](RELEASE_CANDIDATE_CHECKLIST.md) §3 — the backup/PITR prerequisite this drill proves is real, not just configured
- [`STAGING_DEPLOYMENT_CHECKLIST.md`](STAGING_DEPLOYMENT_CHECKLIST.md) — the environment this drill must run against
