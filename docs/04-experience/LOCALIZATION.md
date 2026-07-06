# BARQ Localization

- **Purpose:** Define BARQ's localization architecture — how BARQ supports multiple languages, cultures, regions, currencies, dates, text direction, and future international expansion. This document defines localization architecture only, not implementation, not translations, not code.
- **Scope:** Localization principles, supported languages, text direction, translation strategy by content type, regional formatting, currency strategy, time zone strategy, search localization, AI localization, notification language handling, accessibility integration, and future expansion.
- **Out of Scope:** Implementation of any kind, translation files, JSON, code, specific translated copy.
- **Dependencies:** `PROJECT_MANIFEST.md` (Design Philosophy §8, Core Value 4), `ADR-0005-bilingual-architecture.md` (the binding architectural principle this entire document operationalizes into a complete architecture — referenced throughout, never restated), `DESIGN_SYSTEM.md` §16 (localization at the interface layer — this document is that section's fuller architectural treatment), `DATABASE_DESIGN.md` §7 (localization storage strategy — this document elaborates it without duplicating), `ADR-0006-database-baseline.md` (UTC time strategy, Amount/Currency pair — carried through §7–§8 below), `GLOSSARY.md` (its own Open Question #1 on MSA vs. colloquial Arabic is directly relevant to §3), `AI_STRATEGY.md` §2/§4, `AI_AGENTS.md` (governing §10), `API_CONTRACTS.md` §5 (Language Negotiation — resolved by this document, see §3).
- **Status:** Approved v1.0 — Locked. Batch-approved via `ARCHITECTURE_FREEZE_V1.md`. Future changes only via ADR, per `PROJECT_RULES.md` §10 and §4.
- **Owner:** CTO / Principal Architect / Design Lead (BARQ core team).

---

## 1. Executive Summary

BARQ's localization architecture exists to make `PROJECT_MANIFEST.md`'s commitment — "Arabic-first is an identity commitment, not a localization checkbox" — structurally true, not just stated. `ADR-0005` established that Arabic and English carry full parity across every layer; this document is where that principle becomes a complete architecture: which languages are supported and how they fail over, how text direction is handled without over-mirroring, how every category of content (static, dynamic, user-generated, AI-generated, administrative) gets translated appropriately to its own risk profile, and how dates, currency, and search all remain locale-aware without becoming locale-*assuming*. `DESIGN_SYSTEM.md` §16 already stated the interface-level implications; `DATABASE_DESIGN.md` §7 already stated the storage-level requirement. This document is the layer that ties both to a single, coherent localization architecture, and resolves the language-negotiation question both of those documents — and `API_CONTRACTS.md` §5 and `ADR-0005` itself — left open.

## 2. Localization Principles

- **Bilingual by Design:** Per `ADR-0005`, referenced not restated — the foundation everything below builds on.
- **Arabic First:** Arabic is the default at every decision point where a default must be chosen (§3, §6) — not merely "supported equally," but the platform's starting assumption.
- **English Equal Support:** Full parity, never a fallback-only or secondary treatment — per `ADR-0005` requirement 2.
- **Future Multi-Language:** Every mechanism in this document (§3, §5) is designed so a third language is a content operation, never an architecture change — per `ADR-0005` requirement 9.
- **Cultural Awareness:** Localization is not only translation — regional formatting (§6), address conventions, and search behavior (§9) reflect real Oman/GCC usage, not a generic template applied to two languages.
- **Consistency:** The same localization behavior (direction, formatting, fallback) applies identically across every module — a Booking's date and an Invoice's date format the same way, per the same rule, everywhere.
- **Accessibility:** Governed jointly with `DESIGN_SYSTEM.md` §15; §12 below states the specific intersection.
- **Performance:** Localization must not become a latency cost — locale resolution and content retrieval are designed to be as fast as a single-language system would be, consistent with `ARCHITECTURE_PRINCIPLES.md` Principle 13.

## 3. Supported Languages

- **Arabic:** The default language, Modern Standard Arabic per `GLOSSARY.md`'s own stated choice — that document's Open Question #1 (whether Gulf colloquial variants should be documented for customer-facing UI copy) remains open and is not resolved here; it belongs to `GLOSSARY.md` and, downstream, to actual UI copywriting, not to this architecture document.
- **English:** Fully equal, per `ADR-0005`.
- **Future Languages:** Architecturally supported without a redesign (`ADR-0005` requirement 9) — the localization storage strategy (`DATABASE_DESIGN.md` §7) and the negotiation mechanism (below) are both designed to extend to N languages, not hard-coded to exactly two.
- **Fallback Strategy — resolved by this document:** Language resolution follows this priority order: (1) an authenticated user's explicit, stored language preference; (2) request-level language negotiation for unauthenticated or first-time contexts; (3) Arabic, as the platform default, if neither of the above resolves. For missing localized content specifically (a field not yet translated into the requested language), the fallback chain is: requested language → Arabic → English → never blank. This resolves the open question carried across `ADR-0005` (Open Question #2), `API_CONTRACTS.md` §5/§19, and `DATABASE_DESIGN.md` §7/§20 — each of those documents deferred this exact decision to whichever document ended up owning localization architecture in full; this is that document. **This resolution is stated here; it has not been back-propagated into those other documents' text in this same pass** — see Open Questions for why, and for the explicit offer to do that cross-reference pass as its own deliberate action.

## 4. Text Direction

- **RTL:** The layout direction for Arabic content, per `ADR-0005` — a first-class layout mode, not a mirrored transform of an LTR-built screen (`DESIGN_SYSTEM.md` §16).
- **LTR:** The layout direction for English content.
- **Layout Mirroring:** Applied where reading direction genuinely affects meaning (navigation order, form field order, directional icons) — not applied wholesale, per the distinction `DESIGN_SYSTEM.md` §16 already drew.
- **Exceptions (not mirrored regardless of direction):**
  - **Maps:** Real-world geographic orientation is never mirrored — a map facing "wrong" would misrepresent physical reality, not just reading order.
  - **Numbers:** Numeral sequence (e.g. a phone number's digit order, a Price's digit order) is never mirrored — digits read left-to-right by mathematical convention regardless of surrounding text direction. *Which numeral glyphs* (Western Arabic vs. Eastern Arabic numerals) is a separate, still-open decision (§15, carried from `DESIGN_SYSTEM.md` §22).
  - **Icons:** Directional icons (e.g. "next/forward") mirror per direction; non-directional icons (a Booking icon, a Wallet icon) do not — per `DESIGN_SYSTEM.md` §16.
  - **Charts:** Data visualization directionality (e.g. a time-series chart's left-to-right progression) is a genuine open design question, not resolved here — many RTL products keep chart time-axes LTR by data convention even in an otherwise-RTL interface, but this has not been decided for BARQ (§15).

## 5. Translation Strategy

Each content category carries a different translation approach and risk profile — treating them identically would either over-invest in low-risk content or under-invest in high-risk content:

- **Static Content:** UI strings (buttons, labels, system messages) — sourced from a centralized i18n system per `ADR-0005` requirements 7–8; hardcoded text is prohibited anywhere, without exception.
- **Dynamic Content:** Business-entity content marked Localization-required in `DATABASE_DESIGN.md` §5 (`Provider` business name/description, `Service`/`Experience` name/description) — authored bilingually by the owning party (the Provider), not machine-translated by the platform on their behalf, since a Provider's own business description is their own voice, not BARQ's to paraphrase.
- **User-Generated Content:** `Review` text is stored and displayed exactly as submitted, in whichever language the Customer wrote it — per `DOMAIN_MODEL.md` §5's note that Reviews carry "no structural requirement beyond storing submitted text as-is." BARQ does not auto-translate UGC in V1; a future AI-assisted translation *display* aid (not a replacement of the original) is a candidate future item (§13), not a current architecture commitment.
- **AI-Generated Content:** Every AI Agent (`AI_AGENTS.md` §4–§10) generates its response natively in the requested language — it does not generate a canned response in one language and machine-translate it, since quality parity between Arabic and English responses is itself a bilingual-parity requirement (`ADR-0005`), not just a translation nicety. Governed in full by §10 below.
- **Administrative Content:** `Invoice` and `Contract` bilingual content (`DATABASE_DESIGN.md` §5) is legal-grade — both language versions are authored/reviewed to the same legal standard, not a literal machine translation of one into the other, given the legal and financial consequence these documents carry.

## 6. Regional Formatting

- **Dates / Times:** Stored in UTC (`ADR-0006`), displayed in the user's locale and, where relevant, their actual timezone (§8) — this document does not redefine the storage rule, only its localized presentation.
- **Numbers:** Locale-appropriate decimal and thousands separators; numeral glyph choice remains an open decision (§4, §15).
- **Currency:** Displayed per `ADR-0006`'s (Amount, Currency) pair, formatted per locale convention (symbol/code placement, decimal precision) — the underlying value and currency are never altered by formatting, only their presentation.
- **Addresses:** Oman/GCC address conventions differ structurally from a generic Western multi-line format assumption — a specific address-format definition is not decided in this document (§15), but the requirement that BARQ not assume a Western address shape is stated here.
- **Phone Numbers:** Stored and validated in a consistent international format (`AUTHENTICATION.md`'s Identity context dependency), displayed per locale-conventional formatting — never mirrored under RTL, per §4.
- **Units:** Metric by default, consistent with Oman/GCC convention — no imperial-unit support is currently required; flagged for revisit only if international expansion (§13) ever introduces a market where that assumption doesn't hold.

## 7. Currency Strategy

- **Display Currency:** Oman Rial (OMR) at launch, always shown explicitly paired with its currency per `ADR-0006` — never a bare number where currency could be ambiguous.
- **Future Multi-Currency:** GCC expansion (`BUSINESS_MODEL.md` §12) introduces additional currencies (e.g. AED, SAR) tied to each market's own Tenant (`DATABASE_DESIGN.md` §8) — each market transacts in its own currency; this is an extension of the existing (Amount, Currency) pair model, not a redesign of it.
- **Exchange Rate Independence:** BARQ does not perform currency conversion or maintain exchange rates — each market's Bookings are priced and settled entirely within that market's own currency, with no cross-currency conversion logic anywhere in the platform. This is a deliberate architectural simplification consistent with Cost-Aware Architecture (`ARCHITECTURE_PRINCIPLES.md` Principle 26): currency conversion introduces real financial-regulatory complexity BARQ does not need to take on while operating single-currency markets. A future scenario (e.g. an Enterprise account operating across multiple markets wanting a consolidated multi-currency view) would need to be evaluated separately if it ever arises (§15) — it is not designed for now.

## 8. Time Zone Strategy

- **UTC Storage:** Per `ADR-0006`, referenced not restated.
- **User Display:** Converted to the user's local timezone at the presentation layer only, per `ADR-0006`'s original reasoning.
- **Scheduling:** A Provider setting `Availability` (`DOMAIN_MODEL.md`) enters times meaningful in *their own* local context (e.g. "9am–5pm" means Oman local time to that Provider) — this must be captured with correct timezone context at input and converted to UTC for storage, not naively stored as if the Provider's wall-clock time were already UTC. This is stated explicitly because it is a common, easy-to-get-wrong failure mode in UTC-storage systems, not a hypothetical concern.
- **Booking Time:** A `Booking`'s service time is fundamentally the Provider's local service time (the tour happens where and when the Provider operates); a Customer viewing it — even from a different timezone in a future multi-market context — must see a correctly converted, unambiguous time, never a raw UTC value presented without context. At V1's single-market (Salalah) scale this has limited practical impact, but the principle is stated now so GCC expansion (multiple timezones across markets) doesn't require revisiting it later.

## 9. Search Localization

- **Arabic Search:** Requires diacritic-insensitive matching, since Arabic script diacritics are frequently and inconsistently omitted in real usage — a search that requires exact diacritic matching would fail for most real queries.
- **English Search:** Standard case-insensitive matching.
- **Mixed Queries:** A query combining Arabic and English terms (a realistic pattern in a bilingual market) must still return relevant results — search is not designed as if a query is ever purely monolingual.
- **Normalization:** Arabic letter-variant normalization (e.g. treating ه/ة and ا/أ/إ variants as equivalent for matching purposes) is required — without it, search recall in Arabic would be materially worse than in English, itself a bilingual-parity failure.
- **Future Transliteration:** Matching an Arabic term typed in Latin script (or vice versa) — a common pattern in GCC digital products — is a candidate future capability (§13), not committed for V1.

## 10. AI Localization

Fully governed by `AI_STRATEGY.md` §2/§4 and `AI_AGENTS.md`; this section states the localization-specific implications:

- **Language Detection:** Every AI Agent (`AI_AGENTS.md` §4–§10) detects the language of the input it receives rather than assuming one — a Customer writing in Arabic is never met with an English-only response by default.
- **Response Language:** The Agent responds in the detected (or the user's stored preference, per §3) language, generated natively per §5's AI-Generated Content rule — never a translated-after-the-fact response.
- **Context Preservation:** If a user switches language mid-conversation, the Agent preserves conversational context rather than treating the switch as a new, disconnected interaction — a language switch is a presentation change, not a memory-loss event.
- **Human Escalation:** When an Agent escalates to a human (`AI_AGENTS.md` §13), the language context travels with the handoff, per `AI_AGENTS.md` §11's Shared Context principle — the receiving human should know immediately which language to continue the conversation in, not have to re-derive it.

## 11. Notifications

- **WhatsApp / Email / SMS:** Per `TECH_STACK.md` §10's Communication stack — this document governs their language content, not their delivery mechanics.
- **Preferred Language:** Every `Notification` (`DOMAIN_MODEL.md`) is composed in the recipient's preferred language (§3's resolved priority order) — content must exist in both languages before sending, per that entity's own stated invariant; this document does not relax that requirement, only clarifies which language is selected for a given recipient.
- **Fallback:** If, in some edge case, preferred-language content is genuinely unavailable, the fallback is Arabic (the platform default) — never a blank or failed notification, consistent with §3's general fallback chain.

## 12. Accessibility Integration

- **Screen Readers:** Must announce content correctly in both Arabic (RTL) and English (LTR) reading order — per `DESIGN_SYSTEM.md` §15, this is a binding requirement, not a nice-to-have.
- **RTL / LTR:** Reading order for assistive technology must match the visual/logical order in both directions — a screen reader that works correctly in LTR but produces a garbled RTL reading order is a real accessibility failure, not a minor localization quirk.
- **Localization Impact:** Accessibility compliance is evaluated per language/direction independently (`DESIGN_SYSTEM.md` §15) — passing an accessibility audit in English only is not passing BARQ's accessibility bar at all, per `ADR-0005`'s equal-experience requirement.

## 13. Future Expansion

- **GCC:** Every GCC country has Arabic as an official language and English in wide commercial use — the current two-language architecture is expected to hold through GCC expansion (`BUSINESS_MODEL.md` §12) without necessarily requiring a third language, though Gulf dialect/register considerations (`GLOSSARY.md` Open Question #1) may still warrant attention at the content level.
- **International:** Expansion beyond the GCC (flagged as a tension already surfaced in `BUSINESS_MODEL.md` §12's Open Questions, relative to `PROJECT_MANIFEST.md`'s current "GCC-wide" Vision wording) could introduce genuinely new languages — this document's architecture (§3's future-language support) is designed to accommodate that without a redesign, regardless of how that separate business-scope question is eventually resolved.
- **Additional Languages:** Added as a content/configuration operation per `ADR-0005` requirement 9 and §3 above — never an architecture change.
- **Regional Policies:** Country-specific regulatory or cultural localization nuances are owned by future `COMPLIANCE_AND_LEGAL.md`, not this document — flagged as a dependency, not addressed here.

## 14. Anti-Patterns

Explicitly forbidden, without exception:

- Never hardcode strings — per `ADR-0005` requirement 8; every user-facing string comes from the centralized i18n system (§5).
- Never duplicate translations — a translated string exists once per key/context, never copy-pasted with drift risk into multiple places (Single Source of Truth, `ARCHITECTURE_PRINCIPLES.md` Principle 2).
- Never assume one locale — no code path, business rule, or design decision anywhere in BARQ assumes Arabic-only or English-only usage, ever.
- Never store local time — per `ADR-0006`; UTC storage is absolute, timezone-aware conversion happens only at input (§8) and display.
- Never mix RTL and LTR incorrectly — per §4's Exceptions list; mirroring what shouldn't be mirrored (numbers, maps) is exactly as wrong as failing to mirror what should be (navigation, form order).

## 15. Open Decisions

Intentionally deferred — not invented here:

1. **Numeral glyph choice** (Western Arabic vs. Eastern Arabic numerals, §4) — carried forward from `DESIGN_SYSTEM.md` §22; a genuine cultural/readability decision, not an engineering default.
2. **Chart/data-visualization directionality convention** (§4) — whether time-series and similar charts remain LTR by data convention even within an RTL interface.
3. **Oman/GCC address format definition** (§6) — not yet specified structurally.
4. **Multi-market currency consolidation** (§7) — whether a future Enterprise/cross-market account ever needs a consolidated multi-currency view; not designed for now.
5. **Search transliteration timing** (§9) — a candidate future capability, no committed timeline.
6. **User-Generated Content translation-assist timing** (§5) — whether/when an AI-assisted translation *display aid* for Reviews is ever added, distinct from auto-translating the original.

---

## Related Documents
- `PROJECT_MANIFEST.md` §8, Core Value 4 — the founding commitment this document architecturally fulfills
- `ADR-0005-bilingual-architecture.md` — the binding principle this document operationalizes in full; this document resolves that ADR's Open Question #2 (§3)
- `DESIGN_SYSTEM.md` §15–§16 — the interface-layer treatment this document provides the fuller architecture for
- `DATABASE_DESIGN.md` §7 — the storage-layer localization strategy this document builds on without duplicating; this document resolves that section's Fallback Rules open item (§3)
- `ADR-0006-database-baseline.md` — UTC time and Amount/Currency conventions carried through §6–§8
- `GLOSSARY.md` — Open Question #1 (MSA vs. colloquial Arabic), directly relevant to §3 but not resolved here
- `AI_STRATEGY.md` §2/§4, `AI_AGENTS.md` — governing §10 in full
- `API_CONTRACTS.md` §5 — Language Negotiation, resolved by this document's §3
- `BUSINESS_MODEL.md` §12 — the GCC/International expansion trajectory §13 is written against, including its own unresolved Vision-wording tension
- `COMPLIANCE_AND_LEGAL.md` *(not yet written)* — will own Regional Policies (§13)

## Open Questions
1. §3 resolves the language-negotiation fallback question that `ADR-0005`, `API_CONTRACTS.md`, and `DATABASE_DESIGN.md` each deferred — should those three documents now be revised to reference this resolution explicitly, closing their own open items? Flagged deliberately rather than actioned in this same pass, consistent with the process correction established in the prior turn: a cross-document consistency pass is a distinct, explicit action, not a silent side effect of writing this document.
2. Is Arabic-dialect/register handling (`GLOSSARY.md` Open Question #1) something this document's Future Expansion (§13) should take a firmer position on now, given GCC expansion is an active business direction, or does it genuinely wait for `GLOSSARY.md` to resolve first? Flagged, not decided here.

## Future ADR References
- Any decision to support genuine currency conversion (§7, departing from Exchange Rate Independence) would be a significant financial-architecture change requiring an ADR, not a routine update to this document.
- Any resolution of the numeral glyph question (§15, Open Decision #1) that gets adopted platform-wide is a real, hard-to-reverse UX decision once shipped broadly — recommend ADR-level rigor when decided, consistent with the same recommendation already made in `DESIGN_SYSTEM.md`.
