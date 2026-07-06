# BARQ Design System

- **Purpose:** Define BARQ's complete Design System — the single source of truth for visual language, interaction principles, accessibility, responsive behavior, bilingual experience, and reusable UI component architecture. This is design architecture, not implementation.
- **Scope:** Design principles, brand identity, color/typography/spacing systems, iconography, component philosophy, responsive/navigation strategy, forms/tables/maps behavior, motion, accessibility, localization, AI experience, empty states, design tokens, and future evolution.
- **Out of Scope:** Figma files, CSS, Tailwind classes, React components, any implementation. Specific hex/pixel values are stated only where they don't depend on an actual logo asset (see the note immediately below).
- **Dependencies:** `PROJECT_MANIFEST.md` (Design Philosophy §8, Customer/Provider Promises §9–§10), `ARCHITECTURE_PRINCIPLES.md` (Principle 9 Mobile First, Principle 10 Bilingual by Design, Principle 14 Accessibility by Design), `ADR-0005-bilingual-architecture.md`, `DOMAIN_MODEL.md` (entities driving §8's component list), `PRODUCT_REQUIREMENTS.md` (§4 personas, §9 user journeys), `AI_STRATEGY.md` (§2–§4, governing §17), `TECH_STACK.md` (§3, Tailwind CSS/shadcn/ui — referenced at the philosophy level only, never as implementation detail here).
- **Status:** Approved v1.0 — Locked. Batch-approved via `ARCHITECTURE_FREEZE_V1.md`. Future changes only via ADR, per `PROJECT_RULES.md` §10 and §4.
- **Owner:** CTO / Principal Architect / Design Lead (BARQ core team).

---

## A Note on the BARQ Logo

Section 4 instructs this document to reference the BARQ logo for color derivation and Section 3 instructs it not to redesign the logo. No logo file has been provided in this conversation. This document therefore defines the color system's **structure and roles** (§4) and brand identity's **qualities** (§3) without inventing specific hex values as if derived from a real asset that hasn't been supplied — doing so would be fabricating a brand fact, not designing from one. Wherever a specific value would normally appear, this document states the requirement instead and flags it in Open Decisions (§22). This is stated once here rather than repeated at every instance below.

---

## 1. Executive Summary

BARQ's design system exists to make a premium, trustworthy tourism platform feel effortless in Arabic and English alike, on a phone first and everywhere else second. Per `PROJECT_MANIFEST.md` Design Philosophy §8, premium is expressed through clarity, whitespace, typography, and speed — never ornamentation — and RTL is a first-class layout mode, not a mirrored afterthought. This document exists so that every screen BARQ ever ships, regardless of which persona it serves (Customer, Provider, Operations, Admin) or which language a person reads it in, feels like it came from the same disciplined design system, not four different products stitched together.

## 2. Design Principles

- **Trust First** — *Purpose:* every visual and interaction decision reinforces the platform's trustworthiness. *Why:* per `PROJECT_MANIFEST.md`, "trust is the product," not a marketing claim (Core Value 1). *Examples:* transparent pricing display before booking confirmation; visible verification indicators on Provider profiles; never a dark pattern that obscures cost or commitment.
- **Clarity over Decoration** — *Purpose:* premium is restraint, not visual excess. *Why:* directly from `PROJECT_MANIFEST.md` Design Philosophy §8. *Examples:* generous whitespace over dense layouts; typography and hierarchy carry visual weight, not heavy borders or gradients.
- **Speed First** — *Purpose:* every interaction should feel immediate. *Why:* per `ARCHITECTURE_PRINCIPLES.md` Principle 13 (Performance by Design) applied at the interface level — a fast-feeling interface is itself a design decision, not solely an engineering one. *Examples:* perceived-performance patterns (skeleton states, §18) over blank loading screens; minimal steps to complete a Booking.
- **Mobile First** — *Purpose:* design for the phone, then adapt outward. *Why:* `ARCHITECTURE_PRINCIPLES.md` Principle 9, and BARQ's primary Customer surface being mobile web (`PRODUCT_REQUIREMENTS.md` §5). *Examples:* touch-target sizing as the default assumption, not a retrofit; critical actions reachable with one thumb.
- **Desktop Ready** — *Purpose:* Provider Portal, Operations Center, and Admin Dashboard are used on larger screens by people doing real work, and must not feel like a stretched phone layout. *Why:* these personas (`PRODUCT_REQUIREMENTS.md` §4) work at desks, not on the move. *Examples:* denser information display appropriate to desktop (§9's Tables, §12) without abandoning the same visual language as the mobile Customer experience.
- **Accessibility by Design** — *Purpose:* usable by everyone, in both languages. *Why:* `ARCHITECTURE_PRINCIPLES.md` Principle 14, and `ADR-0005`'s requirement that accessibility hold equally in Arabic/RTL and English/LTR. *Examples:* every component in §8 is accessible by default, not accessible-if-remembered.
- **Bilingual by Design** — *Purpose:* Arabic and English carry full parity, always. *Why:* `ADR-0005`, referenced not restated. *Examples:* RTL is a first-class layout direction throughout §9, §13, §16, not a mirrored CSS transform applied after the fact.
- **Consistency** — *Purpose:* the same pattern means the same thing everywhere it appears. *Why:* `ARCHITECTURE_PRINCIPLES.md` Principle 19 (Convention over Configuration), applied to design. *Examples:* one Status Indicator pattern (§8) used identically across Booking, Support Ticket, and Provider Approval states, not a different visual language per module.
- **Minimal Cognitive Load** — *Purpose:* a person should never have to think about how to use BARQ, only about what they want to do. *Why:* directly serves `PROJECT_MANIFEST.md`'s Customer Promise §9 ("never needs to understand BARQ's internal complexity to trust its outcome"). *Examples:* progressive disclosure over showing everything at once; a Staff-Assisted Booking flow (§11) that stays as simple as a phone call, not a form dumped onto a Staff member.
- **Human-Centered AI** — *Purpose:* AI assists visibly and honestly, never invisibly. *Why:* `AI_STRATEGY.md` §2's Transparent Automation principle, expressed at the interface level. *Examples:* AI-originated content is always visually distinguishable (§17) from human/system content; a human escalation path is always one visible action away.

## 3. Brand Identity

- **Brand Personality:** Professional, modern, premium, minimal, welcoming — the specific balance point is that "premium" and "welcoming" must coexist; a cold, minimal interface that reads as unapproachable is a misapplication of these qualities, not a correct one.
- **Voice:** Direct, respectful, never patronizing — consistent with treating both Customers and Providers as capable adults (per this project's own tone conventions applied to product voice).
- **Tone:** Warm but not casual in Arabic or English — the same register in both languages, not a formal English voice paired with an overly casual Arabic one or vice versa, which would itself be a bilingual-parity failure (`ADR-0005`).
- **Visual Direction:** Light-first (§4), clean typography-led hierarchy (§5), generous whitespace, restrained use of color reserved for meaning (status, action) rather than decoration.
- **Logo:** Not redesigned by this document, per instruction. The existing BARQ logo's colors inform §4's palette once the actual asset is available (see the note at the top of this document) — this document does not invent logo-derived values in its absence.

## 4. Color System

**Structure and roles**, without invented hex values (see note above):

- **Primary:** The dominant brand color, derived from the BARQ logo once available — carries the platform's primary calls-to-action and brand presence.
- **Secondary:** A complementary color supporting Primary, used for secondary actions and accents that shouldn't compete with Primary.
- **Accent:** A distinct highlight color for drawing attention to a specific, limited element (e.g. a live-tracking indicator) — used sparingly, consistent with Clarity over Decoration (§2).
- **Success / Warning / Error:** Semantic colors with meaning fixed regardless of brand palette changes — a Booking Confirmed state, a Wallet low-balance warning, and a Payment failure must always be visually distinguishable by color alone as a supporting (never sole) signal, per §15's accessibility requirement that color is never the only means of conveying status.
- **Neutral:** A grayscale range for text, borders, and non-semantic UI structure — the majority of any screen's actual pixel area, consistent with Clarity over Decoration.
- **Surface / Background:** Distinct layering colors so cards, modals, and page background remain visually distinguishable without heavy borders or shadows doing all the work.
- **Text:** A defined set of text colors (primary text, secondary/muted text, disabled text, on-color text) with contrast ratios meeting §15's WCAG AA target against every Surface/Background/semantic color they appear on — this is a binding constraint on the palette, not a separate accessibility afterthought.
- **Dark Mode (future):** Not part of V1 (`PRODUCT_REQUIREMENTS.md` §6 doesn't name it explicitly, but this document treats it as future per §20) — the color system's structure (roles above) is designed so a dark-mode palette can be defined later against the same roles, not requiring a redesign of what each color *means*.

**Accessibility considerations:** Every color role above must satisfy WCAG AA contrast (§15) in both light-mode contexts this document defines now and any future dark-mode context: color is never the sole means of distinguishing state (Success/Warning/Error always pair with an icon or label, not color alone); and the palette must work identically in RTL and LTR layouts, since color has no inherent directionality but surrounding UI does.

## 5. Typography

- **Arabic Font Strategy:** A typeface with genuine Arabic script support and strong readability at UI sizes — not a Latin-first font with a bolted-on Arabic fallback. Specific typeface selection is deferred (§22) pending a real evaluation against BARQ's premium-light visual direction (§3), not chosen speculatively here.
- **English Font Strategy:** A typeface pairing naturally with the Arabic choice above in weight and visual rhythm, so switching languages doesn't feel like switching products. Specific typeface selection likewise deferred (§22).
- **Scale:** A defined, limited type scale (a small number of sizes, not an unbounded range) — consistent with Minimal Cognitive Load (§2) and Consistency.
- **Hierarchy:** Heading/body/caption levels clearly distinguished by size and weight, not by color or decoration alone.
- **Weights:** A limited weight set (e.g. regular, medium, bold) sufficient for hierarchy without visual clutter — exact weights depend on the final typeface choice (§22).
- **Spacing:** Line-height and letter-spacing tuned per language — Arabic script has different vertical rhythm needs than Latin script, and this document treats that as a first-class typographic requirement, not an equal-values assumption across both languages.
- **Readability:** Body text sizing prioritizes readability on mobile (§2, Mobile First) over information density — density is a desktop-context allowance (§9), not a mobile default.

## 6. Spacing System

- **Grid:** A consistent base unit driving all spacing decisions, so spacing is systematic rather than ad hoc per screen.
- **Margins / Padding:** Defined at a small number of standard increments (per the base unit above) — consistent with Consistency (§2) and Convention over Configuration.
- **Radius:** A limited set of corner-radius values applied consistently across Cards, Buttons, Inputs, and Dialogs (§8) — one visual language for "roundedness," not a different radius per component invented independently.
- **Elevation:** A limited set of shadow/elevation levels distinguishing layered surfaces (Cards vs. Modals vs. Dropdowns), used meaningfully — elevation communicates z-order, not decoration.
- **Consistency Rules:** No screen introduces a one-off spacing value outside the defined grid — a deviation is a design-system gap to raise, not a one-off exception to quietly take.

## 7. Iconography

- **Style:** A single, consistent icon style (e.g. line-weight and corner treatment matching the Radius system, §6) across the entire platform — never mixing icon styles from different sources.
- **Consistency:** The same icon always means the same thing across every screen and persona — an icon is part of the platform's shared visual vocabulary, not reinvented per feature.
- **Size:** A limited set of icon sizes tied to the type scale (§5), so icons and adjacent text always feel proportionate.
- **Meaning:** Icons support text labels; they are not used as the sole means of conveying meaning for anything consequential (booking actions, status), consistent with §15's accessibility requirement — an icon-only control needs an accessible label regardless of whether text is visually shown.

## 8. Component Philosophy

Reusable, composable components — each used consistently across every persona's interface rather than reinvented per module:

- **Buttons:** A small set of variants (primary, secondary, destructive, ghost) with consistent sizing and states (default, hover, disabled, loading) — a destructive action (e.g. cancelling a Booking) always uses the same visual treatment, never ambiguous with a routine action.
- **Inputs:** Consistent field styling, label placement, and validation-state visuals (§11) — RTL/LTR-aware by default (text alignment, icon placement mirror correctly per direction).
- **Cards:** The primary container for Service/Experience listings, Booking summaries, and Provider profiles — one consistent Card pattern, not a different card shape per module.
- **Tables:** Governed in full by §12 — used for Admin/Operations/Provider data-dense views, not for Customer-facing content that Cards serve better.
- **Dialogs:** Used for focused, interruptive decisions (confirming a cancellation, viewing an Invoice) — never for content that could just be a page.
- **Badges:** Small, consistent status/label indicators — paired with the Status Indicators pattern below, not a competing visual language.
- **Alerts:** System-level messages (errors, warnings, success confirmations) distinct from inline field validation (§11) — a different visual weight for "something happened at the page level" vs. "this specific field has an issue."
- **Navigation:** Governed in full by §10.
- **Forms:** Governed in full by §11.
- **Maps:** Governed in full by §13.
- **Timeline:** Used for Journey progress (per `DOMAIN_MODEL.md` Journey entity's lifecycle) and Support Ticket history — a consistent visual pattern for "a sequence of things that happened over time."
- **Status Indicators:** One consistent visual pattern for entity state across the entire platform — a `Booking`'s status, a `Provider`'s approval status, and a `Support Ticket`'s status all use the same underlying Status Indicator component, styled per their own semantic colors (§4), never a bespoke status visual per module (directly enforcing Consistency, §2, and preventing the anti-pattern in §21).
- **Rating:** A consistent visual pattern for displaying and (where applicable) inputting a `Rating` (`DOMAIN_MODEL.md`), used identically wherever Provider trust signals appear.

## 9. Responsive Strategy

- **Mobile:** The primary design target (§2) — single-column layouts, touch-first target sizing, critical actions always reachable without horizontal scrolling.
- **Tablet:** An intermediate layout, typically a relaxed version of mobile rather than a compressed version of desktop — specific breakpoint behavior deferred to implementation, but the *philosophy* (tablet is mobile-plus-space, not desktop-minus-space) is stated here.
- **Desktop:** Used primarily by Provider/Operations/Admin personas (§2's Desktop Ready principle) — multi-column layouts and denser Tables (§12) become appropriate here, not on mobile.
- **Ultra-Wide:** Content remains centered and readable-width rather than stretching to fill excess horizontal space — Clarity over Decoration applies to layout width as much as to color and typography.
- **Breakpoints:** Specific pixel values are an implementation detail, not fixed in this document — the requirement is that breakpoints follow the Mobile → Tablet → Desktop → Ultra-Wide progression above consistently.
- **Behavior:** Layout adapts; component *meaning* never changes across breakpoints — a Status Indicator means the same thing whether it's shown on mobile or desktop, only its size/placement adapts.

## 10. Navigation Philosophy

- **Customer:** The simplest navigation of any persona — a small number of primary destinations (Discover, My Bookings, Wallet/Profile, Support), consistent with Minimal Cognitive Load (§2). No navigation depth that requires more than a couple of taps to reach a core action.
- **Provider:** Slightly more complex, reflecting real business operations (Services/Experiences, Availability, Bookings, Wallet, Profile) — still kept flat and predictable rather than deeply nested.
- **Operations:** Optimized for real-time monitoring (`SYSTEM_ARCHITECTURE.md` §5's Operations module) — navigation prioritizes getting to an active situation fast over browsing a menu tree.
- **Admin:** The most information-dense navigation, reflecting configuration/approval breadth (`DOMAIN_MODEL.md` Administration context) — still organized around clear categories rather than a flat, undifferentiated list of every possible screen.
- **Keep navigation simple, across all four:** per the explicit instruction and Minimal Cognitive Load (§2) — navigation complexity should scale with a persona's real operational needs, never with how many features happen to exist.

## 11. Forms

- **Validation:** Inline, immediate feedback tied to Zod schemas (`TECH_STACK.md` §3) at the philosophy level — the design system doesn't specify the validation library, only that validation feedback appears at the field level, promptly, not only on submit.
- **Errors:** Distinct visual treatment from Alerts (§8) — field-level, specific, actionable (states what's wrong and, where possible, how to fix it) — never a generic "something went wrong."
- **Success:** Clear, brief confirmation — consistent with Speed First (§2), a success state doesn't linger or block the next action unnecessarily.
- **Loading:** Per §14's Motion principles — a form submission shows clear loading feedback, never a silent, ambiguous wait.
- **Auto-Save:** Used where appropriate (e.g. a Provider drafting a Service listing) to prevent lost work — not used where an explicit, deliberate submission matters more (e.g. Booking confirmation should be an intentional action, not silently auto-saved into existence).
- **OTP:** A dedicated, minimal-friction input pattern (`DOMAIN_MODEL.md` Identity context's OTP flow) — large, clear input targets, fast resend affordance, consistent with Speed First and the `PROJECT_MANIFEST.md` Customer Promise of booking feeling "as fast as messaging a friend."
- **Booking Flow:** The single most important form flow on the platform — designed to minimize steps (Minimal Cognitive Load) while never hiding pricing or commitment details (Trust First) — speed and transparency are both non-negotiable here, not traded against each other.

## 12. Tables

- **Sorting / Searching / Filtering:** Consistent controls and placement across every Table instance (Admin, Operations, Provider) — a person learning one Table's controls should be able to predict every other Table's controls.
- **Pagination:** Consistent with `API_CONTRACTS.md` §5–§6's pagination requirement — Tables never attempt to render an unbounded list.
- **Bulk Actions:** Used where a persona's real workflow benefits (e.g. Admin reviewing multiple Provider applications) — never added speculatively where no real bulk-action need exists (Convention over Configuration, §2).

## 13. Maps

- **Tracking:** The live-location view of an active `Journey` (`DOMAIN_MODEL.md`) — clear, calm presentation prioritizing "where is my Driver/Guide right now" over decorative map styling.
- **Markers:** Consistent iconography (§7) for Customer, Provider/Driver/Guide, and destination positions — never ambiguous about which marker represents whom.
- **Provider Locations:** Shown where relevant to discovery (e.g. nearby Service availability), consistent with the same marker language as Tracking.
- **Routes:** Visually distinct from the base map, clear enough to convey progress without needing precise turn-by-turn detail (that's the underlying Maps provider's job per `TECH_STACK.md` §9, not this document's).
- **Journey Progress:** Paired with the Timeline component (§8) alongside the map itself, so progress is conveyed both spatially (map) and sequentially (timeline) — reinforcing Trust First through visible, legible progress.

## 14. Motion

- **Animation Principles:** Motion communicates state change (loading, transition, feedback) — it is never decorative for its own sake, consistent with Clarity over Decoration (§2).
- **Loading:** Skeleton states and progress indicators preferred over blank screens or generic spinners wherever feasible, supporting Speed First's *perceived* performance as much as actual performance.
- **Transitions:** Brief, purposeful, consistent across the platform — a transition should orient a person to what changed, not entertain them.
- **Feedback:** Micro-interactions (button press states, success confirmations) are subtle and fast, never a delay imposed on a person just to show off motion.
- **Respect Reduced Motion:** Every animation defined by this system must have a reduced-motion-respecting equivalent — this is a binding accessibility requirement (§15), not an optional nicety.

## 15. Accessibility

- **WCAG AA Target:** The binding minimum standard for the entire platform — not an aspiration, a requirement, per `ARCHITECTURE_PRINCIPLES.md` Principle 14.
- **Keyboard Support:** Every interactive component (§8) must be fully operable by keyboard alone, in both RTL and LTR layouts.
- **Screen Readers:** Every component carries correct semantic structure and labeling — an icon-only Button (§8) is not accessible just because it looks clear visually.
- **Focus States:** Visually clear, consistent focus indicators across every interactive element — never suppressed for aesthetic reasons.
- **Contrast:** Every color pairing (§4) meets WCAG AA at minimum, verified in both light-mode (and future dark-mode, §20) contexts.
- **RTL / LTR:** Every accessibility requirement above holds equally in both directions, per `ADR-0005` — an accessible LTR experience with a broken RTL screen-reader order is not accessibility compliance, it's a partial, non-compliant claim of it.

## 16. Localization

- **Arabic / English:** Full parity per `ADR-0005`, referenced not restated.
- **RTL / LTR:** Layout direction is a first-class, structural property of every screen — not a CSS mirror-transform bolted onto an LTR-built layout. This document does not specify the implementation mechanism (that's a `TECH_STACK.md`/implementation concern), only that the design must be authored with genuine RTL/LTR parity in mind from the first draft of any screen.
- **Layout Mirroring:** Where mirroring is the correct behavior (e.g. navigation icon placement, form field order), it happens consistently; where mirroring would be incorrect (e.g. a phone number's digit order, a map's real-world orientation), the design system explicitly does not mirror it — RTL is not "flip everything," it's "flip what reading direction actually affects."
- **Icons:** Directional icons (e.g. a "forward" arrow) are mirrored per direction; non-directional icons (e.g. a Booking icon) are not — consistent with the Layout Mirroring distinction above.
- **Numbers:** Numeral presentation (Western Arabic numerals vs. Eastern Arabic numerals) in Arabic-language contexts is a real decision this document does not invent an answer to — flagged in Open Decisions (§22), since it affects readability and cultural expectation and deserves real input, not an assumption.
- **Dates:** Displayed per the user's language/locale at the presentation layer, always derived from the UTC storage already established in `ADR-0006`/`DATABASE_DESIGN.md` — this document doesn't redefine that storage strategy, only its presentation.
- **Currency:** Displayed per `ADR-0006`'s (Amount, Currency) pair — formatted per locale convention (symbol/code placement, decimal separator) without altering the underlying value or currency itself.

## 17. AI Experience

Fully governed by `AI_STRATEGY.md` §2–§4; this section states the interface-level implications:

- **Chat:** The primary interaction pattern for the Customer Assistant (`AI_STRATEGY.md` §3) — a familiar, low-friction conversational pattern in both Arabic and English.
- **Suggestions:** AI-generated suggestions (e.g. recommended Services) are visually distinguishable from organic/algorithmic results, consistent with Transparent Automation.
- **Confidence:** Where an AI response is a recommendation rather than a retrieval of fact (`API_CONTRACTS.md` §13), the interface conveys this distinguishably — never presenting a recommendation with the same visual certainty as a verified fact.
- **Escalation:** A visible, always-available path to human help from any AI interaction — never a dead end where a person is stuck with only the AI Agent and no way out.
- **Transparency:** Every AI-driven interaction is disclosed as such (`AI_STRATEGY.md` §2's Transparent Automation) — no interface pattern that could make an AI Agent appear to be a human Staff member.
- **Human Handoff:** When an AI Agent escalates (per `AI_STRATEGY.md` §8's Fallback to Human), the interface preserves context so the person doesn't have to repeat themselves to the human who picks up — a design requirement serving Minimal Cognitive Load, not just a backend handoff concern.

## 18. Empty States

- **Loading:** Skeleton/progressive states (§14), never a blank screen with no indication anything is happening.
- **No Results:** A clear, non-discouraging message with a suggested next action where possible (e.g. "No Services found nearby — try expanding your search") — never a bare "No results."
- **Offline:** A clear state distinguishing "nothing found" from "you're not connected" — conflating the two would mislead a person into thinking a search genuinely failed.
- **Errors:** Distinct from Alerts (§8) at the whole-screen/whole-section level — a clear explanation and a recovery action, never a raw error dump (consistent with `API_CONTRACTS.md` §18's prohibition on leaking implementation detail, applied at the UI layer).
- **Permissions:** A clear, respectful explanation when something is unavailable due to role/permission (`SYSTEM_ARCHITECTURE.md` §6 Authorization) — never a generic error that leaves a person wondering if something is broken versus simply not permitted to them.

## 19. Design Tokens

**Token philosophy**, not specific values: every visual property in this document (§4–§7, §14) should ultimately be expressible as a named, reusable token rather than a one-off value chosen per screen — this is the mechanism that makes Consistency (§2) enforceable in practice, not just stated as a principle. Token categories: **Colors** (§4's roles), **Typography** (§5's scale/weights), **Spacing** (§6's grid/margins/padding), **Radius** (§6), **Shadow** (§6's elevation), **Motion** (§14's timing/easing), **Z-Index** (a defined, limited stacking order for Dialogs, Dropdowns, and Notifications so layering is predictable rather than accidentally arrived at per component). Actual token values are an implementation artifact (a future, lower-level document or the codebase itself), not defined in this document.

## 20. Future Evolution

- **Dark Mode:** Structurally anticipated by §4's role-based color system; not a V1 commitment.
- **Native Mobile:** Per `PRODUCT_REQUIREMENTS.md` §6/§12 — a future release stage; this design system's component/token philosophy (§8, §19) is intended to transfer conceptually to native, even though native-specific interaction patterns aren't defined here.
- **Wearables, Car Display, Voice UI, AR:** All directional future possibilities, none committed — named here only so this document has an honest place to acknowledge them without pretending to design for them prematurely (Cost-Aware Architecture, applied to design effort as much as engineering effort).

## 21. Anti-Patterns

Explicitly forbidden, without exception:

- Never mix design styles — one design system, applied consistently, per §2's Consistency principle.
- Never duplicate components — a new screen reuses §8's component set; it does not invent a near-identical one-off component (directly mirroring `ARCHITECTURE_PRINCIPLES.md` Principle 18, Composition over Duplication, applied to design).
- Never ignore accessibility — §15 is binding, not optional, on every component and screen.
- Never ignore localization — §16 is binding, not optional, on every component and screen, per `ADR-0005`.
- Never hide AI origin — §17's Transparency requirement holds without exception.
- Never overload screens — Minimal Cognitive Load (§2) is a constraint on every screen's information density, not just a stated aspiration.

## 22. Open Decisions

Intentionally deferred — not invented here:

1. **Specific color palette values** (§4) — pending the actual BARQ logo asset; this document defines roles only.
2. **Specific Arabic and English typefaces** (§5) — pending a real typographic evaluation against the brand direction in §3.
3. **Arabic numeral presentation** (Western Arabic vs. Eastern Arabic numerals, §16) — a genuine cultural/readability decision, not assumed here.
4. **Specific breakpoint pixel values** (§9) — deferred to implementation.
5. **Specific design token values** (§19) — deferred to implementation, once §4–§6's structural decisions and §22 items 1–2 are resolved.
6. **Dark mode commitment timing** (§20) — directionally anticipated, not scheduled.

---

## Related Documents
- `PROJECT_MANIFEST.md` — Design Philosophy §8, the direct source of this document's core direction
- `ARCHITECTURE_PRINCIPLES.md` — Principles 9, 10, 14, 18, 19, each with a design-level expression above
- `ADR-0005-bilingual-architecture.md` — governs §16 in full and constrains §4–§5, §15
- `DOMAIN_MODEL.md` — entities behind §8's Timeline, Status Indicators, and Rating components
- `PRODUCT_REQUIREMENTS.md` — §4 personas informing §10's navigation philosophy, §9 journeys informing §11's Booking Flow
- `AI_STRATEGY.md` — §2–§4, §8, governing §17 in full
- `TECH_STACK.md` — §3, referenced at the philosophy level for Component Philosophy (§8) and token mechanism (§19), never as implementation detail
- `API_CONTRACTS.md` — §5–§6, §18, informing §12's pagination and §18's error-state philosophy
- `LOCALIZATION.md`, `ACCESSIBILITY.md` *(not yet written)* — will own deeper implementation-adjacent detail this document intentionally stays above

## Open Questions
1. This document assumes the BARQ logo, once provided, will inform but not dictate the entire palette (§4 also needs Success/Warning/Error/Neutral roles the logo likely doesn't define). Should logo-derived colors be limited strictly to Primary/Secondary, with the rest designed independently against accessibility requirements? Flagging for confirmation once the actual asset exists, not decided unilaterally now.
2. Should `LOCALIZATION.md` and `ACCESSIBILITY.md` (both referenced above as not yet written) be sequenced soon, given how much of §15–§16 here defers to them? A sequencing question for whoever directs the next phase, not decided here.

## Future ADR References
- Any future decision to commit to Dark Mode, Native Mobile design adaptation, or any of §20's other future-evolution items on a real timeline requires an ADR when actually proposed, not a routine documentation update.
- Resolution of Open Decision #3 (Arabic numeral presentation) is a genuine, hard-to-reverse cultural/UX decision once shipped broadly — recommend it be treated with ADR-level rigor when decided, even though it is not a technology choice.
