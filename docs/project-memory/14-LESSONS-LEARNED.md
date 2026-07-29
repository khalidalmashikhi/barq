# 14 — Lessons Learned

Durable operational lessons — things that cost real time or produced a wrong conclusion once, worth not re-learning.

## Tooling

- **Never use `isolation: "worktree"` for research agents on this repository.** This project has never committed most of its work — almost the entire codebase (logger, admin module, audit log, observability, most `src/lib/` modules, most tests) exists only as *uncommitted* changes in the real working directory. An agent spawned with worktree isolation checks out a fresh worktree from the last real git commit, which is many phases behind — it will confidently report core infrastructure as "not found" when it fully exists on disk. Always research directly in the actual working directory for this repo.
- **`npx prisma generate` can fail with `EPERM` on Windows** while the Next.js dev server holds the query-engine DLL open. Fix: stop the preview server, run `prisma generate` (or `prisma migrate dev`, which calls it), then restart the preview server.
- **`scripts/validate-env.ts` loads `.env` itself** (a hand-rolled parser, not Node's `--env-file`, for Node-version-compatibility reasons) and only fills in a key if it's *not already* in `process.env` — so a shell-level env var always wins over `.env`. When manually testing production-shaped validation locally, either export the exact vars you intend to test or temporarily move `.env` aside — otherwise a stale local `.env` value can silently mask what you're trying to verify.

## Process

- **This repository has never made a git commit during this entire multi-phase session.** `git status`/`git diff --stat` will always show the *entire* accumulated session history, not just the current phase — when reporting "files changed" for a specific phase, scope the list explicitly to what that phase actually touched rather than dumping the full diff, which would misattribute unrelated earlier work.
- **Two documentation registers exist and must not be conflated**: the ADR-gated, versioned architectural constitution (`docs/00-foundation/` … `docs/11-release/`, all "Approved v1.0 — Locked" under `ARCHITECTURE_FREEZE_V1.md`) versus the phase-completion-report register (same subdirectories in practice, but using a lighter "Added Phase X" convention with no ADR gate) versus `docs/project-memory/` (this directory — living memory, no gate at all). Know which one you're writing to before editing.
- **A root-level file can go stale without being deleted.** `DEVELOPMENT_LOG.md` at the repo root (739 lines, ends Entry 061) silently disagrees with the canonical `docs/08-governance/DEVELOPMENT_LOG.md` (978 lines, continues past Entry 080) — the old copy was never removed or redirected when the doc reorganization happened. Always confirm which copy of a file is canonical before trusting its content, especially after any past reorganization.

## Product/content

- **A schema model existing does not mean a feature exists.** `SupportTicket`, `AIAgent`, and `AuditLog`(pre-Phase-5.2) are all real Prisma models with zero or near-zero application code behind them. Always grep for actual read/write call sites in `src/` before claiming a capability is "built" — the schema alone proves nothing about the application layer.
- **A code comment explicitly documenting a placeholder is a good sign, not a red flag** — e.g., "Contact Provider" being honestly disabled, or the homepage's Categories section explicitly labeled as decorative. This codebase's convention of self-documenting known gaps in-place (rather than silently faking a working feature) is worth preserving as new engines get built.
