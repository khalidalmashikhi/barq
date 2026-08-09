# 20 — Permission Matrix (Enterprise Governance Layer)

`docs/03-platform-capabilities/IDENTITY_AND_ACCESS.md` (Approved v1.0 — Locked) already defines the authorization **philosophy** — roles, ownership rules, approval workflows, the permission model's meaning (§5: what View/Create/Update/Delete/Approve/Reject/Delete/Export/Audit/Impersonate each *mean* in principle). That document's own scope explicitly states "Permission model (philosophy only)" — **this document is the concrete, per-module matrix that operationalizes it**, which did not exist before. Do not duplicate §4/§5's philosophy here; this file only adds the module-by-module grid.

**Legend:** V=View, C=Create, U=Update, D=Delete, A=Approve, R=Reject, E=Export, M=Manage (full configuration authority over the module, a superset of the others). ✓ = granted. — = not granted. **T** = target-state only (the module itself doesn't exist yet, so this is a design intent, not a current permission).

## Roles — current reality vs. target

| Role | Exists today? |
|---|---|
| `SUPER_ADMIN` | **Does not exist.** No tiering of Admin — one `Admin` role today. Target-only. |
| `ADMIN` | Real (`Admin` model, `requireAdmin()`). |
| `OPERATIONS` | **Exists in schema** (`StaffRole.OPERATIONS`) but no real feature differentiates it from other Staff roles yet — `requireStaff(role?)` supports checking it, nothing in the app calls it with this specific value today. |
| `SUPPORT` | **Exists in schema** (`StaffRole.SUPPORT`) — same caveat as Operations; doubly relevant since `SupportTicket` itself is schema-only. |
| `FINANCE` | **Exists in schema** (`StaffRole.FINANCE`) — same caveat. |
| `CONTENT` | **Does not exist** — not in the `StaffRole` enum. Target-only; would need a schema addition to `StaffRole` (or a new enum) when the CMS Engine is scoped. |
| `MARKETING` | **Does not exist** — same as Content. |
| `PROVIDER` | Real (`Provider` model, `requireProvider()`). |
| `CUSTOMER` | Real (`Customer` model, `requireCustomer()`). |

See `docs/03-platform-capabilities/IDENTITY_AND_ACCESS.md` §3–§4 for the full Purpose/Responsibilities/Limitations/Ownership narrative behind `ADMIN`/`OPERATIONS`/`SUPPORT`/`FINANCE`/`PROVIDER`/`CUSTOMER` — not restated here. `SUPER_ADMIN`, `CONTENT`, and `MARKETING` are new roles this document introduces to match the product direction's module list; they are not yet named in `IDENTITY_AND_ACCESS.md` at all — adding them there (if adopted) is a Locked-document change requiring the ADR/RFC process, not done by this file.

---

## Categories & Subcategories
*(target — no `Category` model exists yet; every cell below is **T**)*

| Role | V | C | U | D | A | R | E | M |
|---|---|---|---|---|---|---|---|---|
| SUPER_ADMIN | T | T | T | T | T | T | T | T |
| ADMIN | T | T | T | T | T | T | T | T |
| OPERATIONS | T | — | — | — | — | — | — | — |
| SUPPORT | T | — | — | — | — | — | — | — |
| FINANCE | T | — | — | — | — | — | — | — |
| CONTENT | T | T | T | — | — | — | — | — |
| MARKETING | T | — | — | — | — | — | — | — |
| PROVIDER | T | — | — | — | — | — | — | — |
| CUSTOMER | T | — | — | — | — | — | — | — |

## Provider Onboarding & Approval

| Role | V | C | U | D | A | R | E | M |
|---|---|---|---|---|---|---|---|---|
| SUPER_ADMIN | T | — | T | T | T | T | T | T |
| ADMIN | ✓ | — | — | — | ✓ | T | T | ✓ |
| OPERATIONS | T | — | — | — | — | — | — | — |
| SUPPORT | T | — | — | — | — | — | — | — |
| FINANCE | — | — | — | — | — | — | — | — |
| CONTENT | — | — | — | — | — | — | — | — |
| MARKETING | — | — | — | — | — | — | — | — |
| PROVIDER | ✓ (own) | ✓ (own application) | T (own, limited) | — | — | — | — | — |
| CUSTOMER | — | — | — | — | — | — | — | — |

Today: `ADMIN`'s **A** (Approve, `approveProvider()`) and **R** (Reject, `rejectProvider()`, mandatory reason) are both real. `PROVIDER`'s own **C** is real (`applyAsProvider()`), as is self-service resubmission (`resubmitProviderApplication()`, `REJECTED → APPLIED`).

## Services & Pricing

| Role | V | C | U | D | A | R | E | M |
|---|---|---|---|---|---|---|---|---|
| SUPER_ADMIN | T | — | T | T | T | T | T | T |
| ADMIN | ✓ | — | — | — | T | T | T | — |
| OPERATIONS | ✓ | — | — | — | — | — | — | — |
| SUPPORT | ✓ | — | — | — | — | — | — | — |
| FINANCE | ✓ | — | — | — | — | — | — | — |
| CONTENT | — | — | — | — | — | — | — | — |
| MARKETING | — | — | — | — | — | — | — | — |
| PROVIDER | ✓ (own) | ✓ (own) | ✓ (own) | — (archive only, no hard delete) | — | — | — | ✓ (own) |
| CUSTOMER | ✓ (published only) | — | — | — | — | — | — | — |

Today: Provider's V/C/U/M over their own Services and Pricing are fully real (Phase 4.2). `ADMIN`'s Approve/Reject over pricing (target: pricing-control-mode "both-with-approval") does not exist — pricing is provider-controlled only today (BR-014).

## Bookings
*(the most mature module — mostly real today)*

| Role | V | C | U | D | A | R | E | M |
|---|---|---|---|---|---|---|---|---|
| SUPER_ADMIN | ✓ | — | — | — | — | — | ✓ | — |
| ADMIN | ✓ | — | — | — | — | — | T | — |
| OPERATIONS | ✓ | ✓ (Staff-Assisted Booking, per `IDENTITY_AND_ACCESS.md` §4 — target, not yet implemented in code) | — | — | — | — | — | — |
| SUPPORT | ✓ (scoped to ticket) | — | — | — | — | — | — | — |
| FINANCE | ✓ | — | — | — | — | — | T | — |
| CONTENT | — | — | — | — | — | — | — | — |
| MARKETING | — | — | — | — | — | — | — | — |
| PROVIDER | ✓ (own) | — | ✓ (own — accept/reject/start/complete) | — | ✓ (own — accept) | ✓ (own — reject) | — | — |
| CUSTOMER | ✓ (own) | ✓ (own) | ✓ (own — cancel) | — | — | — | — | — |

Today: Customer create/cancel and Provider accept/reject/start/complete are all real (Phases 4.1, 4.2). Admin/Operations/Finance View access is real via direct DB query capability but has no dedicated UI yet (per `04-ADMIN-PLATFORM.md`'s "exactly one admin capability" finding) — technically possible, not built as a feature.

## Commissions & Settlements
*(mostly target — see `08-PRICING-COMMISSIONS.md`)*

| Role | V | C | U | D | A | R | E | M |
|---|---|---|---|---|---|---|---|---|
| SUPER_ADMIN | T | T | T | T | T | T | T | T |
| ADMIN | T (only 3 fixed tiers exist, no UI) | — | T | — | — | — | T | T |
| OPERATIONS | — | — | — | — | — | — | — | — |
| SUPPORT | — | — | — | — | — | — | — | — |
| FINANCE | T | — | — | — | T | — | T | — |
| CONTENT | — | — | — | — | — | — | — | — |
| MARKETING | — | — | — | — | — | — | — | — |
| PROVIDER | T (own — no settlement/payout view exists) | — | — | — | — | — | — | — |
| CUSTOMER | — | — | — | — | — | — | — | — |

Per `IDENTITY_AND_ACCESS.md` §4/§7: Admin sets Commission *policy*; Finance Staff executes within it, never sets it — this document's target cells preserve that distinction.

## Support Tickets
*(schema-only today — every cell is T)*

| Role | V | C | U | D | A | R | E | M |
|---|---|---|---|---|---|---|---|---|
| SUPER_ADMIN | T | — | T | T | T | T | T | T |
| ADMIN | T | — | T | — | T (escalation) | — | T | T |
| OPERATIONS | — | — | — | — | — | — | — | — |
| SUPPORT | T | T (on behalf of user) | T | — | — | — | — | — |
| FINANCE | T (financial-resolution tickets only) | — | T (financial-resolution tickets only) | — | — | — | — | — |
| CONTENT | — | — | — | — | — | — | — | — |
| MARKETING | — | — | — | — | — | — | — | — |
| PROVIDER | T (own) | T (own) | — | — | — | — | — | — |
| CUSTOMER | T (own) | T (own) | — | — | — | — | — | — |

## Internal Messaging
*(does not exist — every cell is T)*

| Role | V | C | U | D | A | R | E | M |
|---|---|---|---|---|---|---|---|---|
| SUPER_ADMIN | T (compliance access only, per BR-002/003's spirit) | — | — | — | — | — | T | T |
| ADMIN | T (compliance access only) | — | — | — | — | — | — | — |
| OPERATIONS | — | — | — | — | — | — | — | — |
| SUPPORT | T (when escalated into a ticket) | — | — | — | — | — | — | — |
| FINANCE | — | — | — | — | — | — | — | — |
| CONTENT | — | — | — | — | — | — | — | — |
| MARKETING | — | — | — | — | — | — | — | — |
| PROVIDER | T (own threads) | T (own threads) | — | — | — | — | — | — |
| CUSTOMER | T (own threads) | T (own threads) | — | — | — | — | — | — |

**Binding constraint (BR-002/BR-003):** no role's **V** here ever includes a counterpart's raw phone/email — messages are mediated content, not contact-info exposure.

## Translations (business content)

| Role | V | C | U | D | A | R | E | M |
|---|---|---|---|---|---|---|---|---|
| SUPER_ADMIN | ✓ | — | T | — | T | T | T | T |
| ADMIN | ✓ | — | — | — | T | T | — | — |
| OPERATIONS | — | — | — | — | — | — | — | — |
| SUPPORT | — | — | — | — | — | — | — | — |
| FINANCE | — | — | — | — | — | — | — | — |
| CONTENT | ✓ | T | T | — | T | T | T | T |
| MARKETING | ✓ | — | — | — | — | — | — | — |
| PROVIDER | ✓ (own content) | ✓ (own content, real — bilingual fields today) | ✓ (own content) | — | — | — | — | — |
| CUSTOMER | ✓ (published only) | — | — | — | — | — | — | — |

Today: Provider's bilingual `{ar, en}` content C/U is real (business name/description, service name/description). The AI-assisted review-state workflow (approve/reject a proposed translation) is entirely target (BR-017).

**Static UI translations are explicitly out of this matrix's scope** — per BR-016, they remain developer-curated, never a runtime-permission concern for any role above.

## Homepage / CMS Content
*(does not exist — every cell is T)*

| Role | V | C | U | D | A | R | E | M |
|---|---|---|---|---|---|---|---|---|
| SUPER_ADMIN | T | T | T | T | T | T | T | T |
| ADMIN | T | T | T | T | — | — | — | T |
| OPERATIONS | — | — | — | — | — | — | — | — |
| SUPPORT | — | — | — | — | — | — | — | — |
| FINANCE | — | — | — | — | — | — | — | — |
| CONTENT | T | T | T | T | — | — | — | T |
| MARKETING | T | T | T | — | — | — | — | — |
| PROVIDER | ✓ (public view only, same as any visitor) | — | — | — | — | — | — | — |
| CUSTOMER | ✓ (public view only) | — | — | — | — | — | — | — |

## Feature Flags
*(does not exist — every cell is T)*

| Role | V | C | U | D | A | R | E | M |
|---|---|---|---|---|---|---|---|---|
| SUPER_ADMIN | T | T | T | T | — | — | T | T |
| ADMIN | T | T | T | — | — | — | — | T |
| OPERATIONS | — | — | — | — | — | — | — | — |
| SUPPORT | — | — | — | — | — | — | — | — |
| FINANCE | — | — | — | — | — | — | — | — |
| CONTENT | — | — | — | — | — | — | — | — |
| MARKETING | T (marketing-scoped flags only) | — | — | — | — | — | — | — |
| PROVIDER | — | — | — | — | — | — | — | — |
| CUSTOMER | — | — | — | — | — | — | — | — |

## Notifications (system-generated)

| Role | V | C | U | D | A | R | E | M |
|---|---|---|---|---|---|---|---|---|
| SUPER_ADMIN | T | T | — | — | — | — | — | T |
| ADMIN | — | T (target — admin-configurable trigger rules) | — | — | — | — | — | T (target) |
| OPERATIONS | — | — | — | — | — | — | — | — |
| SUPPORT | — | — | — | — | — | — | — | — |
| FINANCE | — | — | — | — | — | — | — | — |
| CONTENT | — | — | — | — | — | — | — | — |
| MARKETING | — | T (target — campaign notifications) | — | — | — | — | — | — |
| PROVIDER | ✓ (own, real) | — | ✓ (own — mark read, real) | — | — | — | — | — |
| CUSTOMER | ✓ (own, real) | — | ✓ (own — mark read, real) | — | — | — | — | — |

Today: Customer/Provider's own V/U (read/mark-read) is fully real. Any admin-side C (defining trigger rules) is entirely target.

## Audit Log

| Role | V | C | U | D | A | R | E | M |
|---|---|---|---|---|---|---|---|---|
| SUPER_ADMIN | ✓ (real, no viewer UI yet — direct DB only) | (system-written only) | — | — | — | — | T | — |
| ADMIN | T (no viewer UI exists) | (system-written only) | — | — | — | — | T | — |
| OPERATIONS | — | — | — | — | — | — | — | — |
| SUPPORT | — | — | — | — | — | — | — | — |
| FINANCE | — | — | — | — | — | — | — | — |
| CONTENT | — | — | — | — | — | — | — | — |
| MARKETING | — | — | — | — | — | — | — | — |
| PROVIDER | — | — | — | — | — | — | — | — |
| CUSTOMER | — | — | — | — | — | — | — | — |

**Per `IDENTITY_AND_ACCESS.md` §5's Audit permission philosophy and `ADR-0006`: never Updatable or Deletable by any role, ever, without exception** — this is the one module where **U** and **D** are permanently `—` for every role, not merely unimplemented. Written atomically by the mutation it describes (BR-019), never by direct user action.

## Analytics & Reports
*(entirely unscoped — see `13-OPEN-QUESTIONS.md`; every cell is T pending scoping)*

| Role | V | C | U | D | A | R | E | M |
|---|---|---|---|---|---|---|---|---|
| SUPER_ADMIN | T | — | — | — | — | — | T | T |
| ADMIN | T | — | — | — | — | — | T | — |
| OPERATIONS | T (own domain) | — | — | — | — | — | — | — |
| SUPPORT | T (own domain) | — | — | — | — | — | — | — |
| FINANCE | T (own domain) | — | — | — | — | — | T | — |
| CONTENT | — | — | — | — | — | — | — | — |
| MARKETING | T (campaign performance) | — | — | — | — | — | T | — |
| PROVIDER | T (own performance only, per `IDENTITY_AND_ACCESS.md` §7's distinction between an AI Assistant "Performance insights" view and a platform-level Report) | — | — | — | — | — | — | — |
| CUSTOMER | — | — | — | — | — | — | — | — |

## AI Center Configuration
*(schema-only — every cell is T)*

| Role | V | C | U | D | A | R | E | M |
|---|---|---|---|---|---|---|---|---|
| SUPER_ADMIN | T | T | T | T | T | — | T | T |
| ADMIN | T | — | — | — | T (per ADR-0008 — human approval for any AI action affecting money/trust/PII) | T | — | — |
| OPERATIONS | — | — | — | — | — | — | — | — |
| SUPPORT | — | — | — | — | — | — | — | — |
| FINANCE | — | — | — | — | — | — | — | — |
| CONTENT | — | — | — | — | — | — | — | — |
| MARKETING | — | — | — | — | — | — | — | — |
| PROVIDER | — | — | — | — | — | — | — | — |
| CUSTOMER | — | — | — | — | — | — | — | — |

No role — including `SUPER_ADMIN` — ever grants an AI Service Identity permission directly through this matrix; per `IDENTITY_AND_ACCESS.md` §9 and BR-020, an AI Agent's access is a fixed grant defined by its own governing specification, never a row a human role assigns to it.
