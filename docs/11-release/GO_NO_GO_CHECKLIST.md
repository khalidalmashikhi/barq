# BARQ — Go/No-Go Checklist

Produced by the Code Freeze / Operational Validation phase. This is the final gate before a real production deployment is scheduled — it assumes every other document produced in this phase ([`CODE_FREEZE_CHECKLIST.md`](CODE_FREEZE_CHECKLIST.md), [`STAGING_DEPLOYMENT_CHECKLIST.md`](STAGING_DEPLOYMENT_CHECKLIST.md), [`DISASTER_RECOVERY_DRILL.md`](DISASTER_RECOVERY_DRILL.md), [`LOAD_TEST_PLAN.md`](LOAD_TEST_PLAN.md), [`SECURITY_SCAN_PLAN.md`](SECURITY_SCAN_PLAN.md)) has actually been executed against staging, not just planned. **As of this phase, none of them has been executed yet** — this checklist is what the owner runs through once they have.

---

## Go/No-Go Items

| # | Item | Evidence Required | Status |
|---|---|---|---|
| 1 | Code freeze confirmed | [`CODE_FREEZE_CHECKLIST.md`](CODE_FREEZE_CHECKLIST.md) §4 fully checked; no uncommitted app-code change since freeze | Not yet run |
| 2 | Migration history risk understood | [`CODE_FREEZE_CHECKLIST.md`](CODE_FREEZE_CHECKLIST.md) §2 reviewed by whoever owns the production deploy — the four non-additive migrations are a known, accepted, zero-risk-for-a-first-deploy fact, not a surprise discovered mid-deploy | Reviewed this phase — owner sign-off pending |
| 3 | Staging environment provisioned | [`STAGING_DEPLOYMENT_CHECKLIST.md`](STAGING_DEPLOYMENT_CHECKLIST.md) fully checked | Not yet run |
| 4 | Disaster Recovery Drill passed | [`DISASTER_RECOVERY_DRILL.md`](DISASTER_RECOVERY_DRILL.md) §8 verdict is **Pass** (Conditional Pass acceptable only with an explicit owner decision on the measured RTO) | Not yet run |
| 5 | Load test — public browsing (Scenario A) | All four stages meet [`LOAD_TEST_PLAN.md`](LOAD_TEST_PLAN.md) §7 thresholds | Not yet run |
| 6 | Load test — authenticated reads (Scenario B1) | Same thresholds | Not yet run |
| 7 | Load test — booking creation (Scenario B2) | Explicit owner approval obtained *before* running; approved VU counts only; thresholds met; staging DB connection pool never exhausted | Not yet run, not yet approved |
| 8 | Security — ZAP passive scan | No Medium+ finding on an application-rendered page ([`SECURITY_SCAN_PLAN.md`](SECURITY_SCAN_PLAN.md) §1) | Not yet run |
| 9 | Security — authenticated route + IDOR checks | Every check in [`SECURITY_SCAN_PLAN.md`](SECURITY_SCAN_PLAN.md) §2–§3 passes, including the re-confirmation of the provider-deactivation gap-closure fix in a real staging environment | Not yet run |
| 10 | Security — headers + TLS | [`SECURITY_SCAN_PLAN.md`](SECURITY_SCAN_PLAN.md) §4–§5 fully pass | Not yet run |
| 11 | Production environment variables ready | [`RELEASE_CANDIDATE_CHECKLIST.md`](RELEASE_CANDIDATE_CHECKLIST.md) §1 fully checked, real secrets set (not staging's) | Not yet run |
| 12 | External dependencies configured | Real Twilio production credentials set; `PAYMENT_PROVIDER` intentionally `NONE` (or explicitly approved otherwise) | Not yet run |
| 13 | Monitoring/alerting live | External uptime monitor wired to production `/api/health`, test alert confirmed firing | Not yet run |
| 14 | Emergency contacts populated | [`PRODUCTION_RUNBOOK.md`](../07-infrastructure/PRODUCTION_RUNBOOK.md) §12 placeholder table filled in with real names/channels | Not yet run |
| 15 | Rollback mechanism confirmed understood | Whoever holds deploy access has read [`PRODUCTION_RUNBOOK.md`](../07-infrastructure/PRODUCTION_RUNBOOK.md) §6–§7 and the corrected migration-risk note in §2 | Not yet run |
| 16 | **Oman OTP delivery readiness (Level B)** | **Real `+968` SMS delivery verified to an Omani handset**, plus Twilio Messaging Geographic Permissions for Oman, sender eligibility, Alphanumeric Sender ID registration (Omantel/Ooredoo), and per-carrier delivery — BARQ uses Twilio **Programmable Messaging**, so it depends on real carrier delivery, not Verify. See [`STAGING_EXECUTION_GUIDE.md`](STAGING_EXECUTION_GUIDE.md) §5's two-level model. | Not yet run |

## Go/No-Go Decision Rule

- **GO**: every item above is checked, items 4/5/6/8/9/10 all report a Pass verdict against their own document's explicit criteria, item 7 (if run at all) was both approved in advance and passed, and item 16 (Oman OTP delivery, Level B) has passed.
- **CONDITIONAL GO**: items 1–3, 8–16 all pass, and item 4 (DR Drill) is a Conditional Pass (data integrity/migration verification passed, RTO exceeded the 60-minute target) — acceptable only if the owner explicitly accepts the measured RTO/RPO numbers as a known, documented operational risk, not silently.
- **NO-GO**: any Medium+ security finding, any IDOR check failure, any DR Drill data-integrity/application-smoke failure, any load-test threshold breach accompanied by a real `/api/health` availability drop, or any of items 11–16 still incomplete. **Production launch is explicitly blocked until item 16 (real `+968` SMS delivery and Oman sender-compliance) passes** — a successful Twilio API acceptance does not prove handset delivery, and trial-account verification does not prove Omani carrier compatibility.

## Current Status (as of this phase)

**No item above has been executed against a real staging environment yet.** This phase produced the plans, corrected the pre-existing migration-safety documentation error, and re-confirmed the Release Candidate's own quality gates (unchanged, still clean). The next action is entirely operational: provision staging per §1–§8 of [`STAGING_DEPLOYMENT_CHECKLIST.md`](STAGING_DEPLOYMENT_CHECKLIST.md), then work through items 4–10 above in order, then close items 11–16 before scheduling a real production deploy. Item 16 (Oman `+968` OTP delivery, Level B) is a hard production blocker independent of staging sign-off, which requires only Level A.
