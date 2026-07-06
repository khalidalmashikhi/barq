# BARQ Accessibility

- **Purpose:** Define BARQ's accessibility architecture — ensuring BARQ is usable by the widest possible range of users regardless of physical, visual, auditory, cognitive, or technical limitations. Accessibility is a permanent product quality requirement, not an optional enhancement. This document defines accessibility principles only, not implementation, not code.
- **Scope:** Accessibility principles, WCAG philosophy, visual/keyboard/screen-reader accessibility, RTL and localization accessibility, forms, motion, AI accessibility, notifications, performance intersection, and future evolution.
- **Out of Scope:** Implementation, CSS, code, specific tooling. Specific numeric contrast ratios beyond the WCAG AA target already fixed in `DESIGN_SYSTEM.md` §15.
- **Dependencies:** `PROJECT_MANIFEST.md` (Quality Standard §11 — "if it doesn't work correctly in Arabic first, it isn't finished," extended here to accessibility generally), `ARCHITECTURE_PRINCIPLES.md` Principle 14 (Accessibility by Design), `DESIGN_SYSTEM.md` §15 (the WCAG AA target and component-level accessibility requirements this document elaborates architecturally), `LOCALIZATION.md` §4/§12 (RTL/LTR and localization-accessibility intersection, governing §7 in full), `AI_STRATEGY.md` §2, `AI_AGENTS.md` §13–§14 (governing §10), `AUTHENTICATION.md` §10 (OTP/UX accessibility), `IDENTITY_AND_ACCESS.md` (no direct dependency, included per instruction for completeness of context).
- **Status:** Approved v1.0 — Locked. Batch-approved via `ARCHITECTURE_FREEZE_V1.md`. Future changes only via ADR, per `PROJECT_RULES.md` §10 and §4.
- **Owner:** CTO / Principal Architect / Design Lead (BARQ core team).

---

## 1. Executive Summary

BARQ's accessibility commitment follows directly from `PROJECT_MANIFEST.md`'s Quality Standard: a platform that doesn't work correctly for everyone isn't finished, the same way a platform that doesn't work correctly in Arabic isn't finished. `DESIGN_SYSTEM.md` §15 already fixed WCAG AA as the binding minimum and stated that accessibility must hold equally in RTL and LTR; `LOCALIZATION.md` §12 already stated the specific intersection between localization and accessibility. This document is where those commitments become a complete architecture — covering not just visual and keyboard accessibility in the abstract, but the specific, real intersections BARQ's product actually has with accessibility: a live-tracking map that needs a non-visual equivalent, an AI conversation that must be as usable with a screen reader as with sight, and a bilingual interface where "accessible" has to mean the same thing in both languages or it doesn't mean it at all.

## 2. Accessibility Principles

- **Accessibility by Design:** Per `ARCHITECTURE_PRINCIPLES.md` Principle 14 — accessibility is a design-time input to every component (`DESIGN_SYSTEM.md` §8), never a post-launch audit-and-fix pass.
- **Inclusive UX:** Designed for the actual range of BARQ's users — varying vision, motor ability, cognitive load tolerance, and technical familiarity — not for an assumed "typical" user with everyone else treated as an edge case.
- **Keyboard First:** Every interactive component (`DESIGN_SYSTEM.md` §8) is fully operable by keyboard alone before any mouse/touch-specific enhancement is layered on top.
- **Screen Reader Friendly:** Every screen carries correct semantic structure and labeling by default, in both Arabic and English (§6–§7).
- **Low Cognitive Load:** Directly extends `DESIGN_SYSTEM.md` §2's Minimal Cognitive Load principle — accessibility and simplicity reinforce each other; a confusing interface is inaccessible to more people than a technically non-compliant one, even when it passes an automated audit.
- **Consistent Navigation:** The same navigation pattern (`DESIGN_SYSTEM.md` §10) behaves identically every time it appears — predictability is itself an accessibility property, especially for cognitive accessibility.
- **Performance Matters:** Governed in full by §12 — an accessible feature that's too slow to use on a real device or network isn't actually accessible.
- **Human Dignity:** No accessibility accommodation calls attention to itself as a special case or treats the person using it as a deviation from a "normal" user — accessible and non-accessible experiences are the same experience, not a separate, lesser one.

## 3. Accessibility Standards

BARQ targets **WCAG AA**, per `DESIGN_SYSTEM.md` §15 — restated here as the fixed floor, not reopened for debate. The four WCAG principles, stated as philosophy rather than a checklist:

- **Perceivable:** Information and interface elements must be presentable to users in ways they can perceive — regardless of which sense (sight, hearing) is available to them. This is why color is never the sole signal (§14) and why maps/charts need non-visual equivalents (§7).
- **Operable:** Interface components must be operable by anyone, through any input method — this is why Keyboard First (§2) is a principle, not a checklist item, and why nothing traps a user in a state they can't get out of (§14).
- **Understandable:** Information and interface operation must be understandable — this is where Low Cognitive Load (§2) and Consistent Navigation (§2) do double duty as both usability and accessibility properties.
- **Robust:** Content must be robust enough to work with a wide variety of assistive technologies, now and as they evolve — this is why §6's ARIA Philosophy prefers native semantic structure over ARIA patches wherever possible, since native structure ages better across assistive-technology changes than a bespoke ARIA implementation does.

## 4. Visual Accessibility

- **Color Contrast:** Every color pairing in `DESIGN_SYSTEM.md` §4 must meet WCAG AA contrast — this document does not restate specific ratios, only confirms the requirement is binding on every color role, including any future Dark Mode palette (below).
- **Typography:** Per `DESIGN_SYSTEM.md` §5 — sizing and hierarchy support readability first, in both Arabic and English, with their genuinely different vertical-rhythm needs respected rather than forced into identical values.
- **Scalable Text:** Text must resize (browser/OS-level zoom, text-size preferences) without breaking layout or clipping content — this is a binding requirement, not a nice-to-have, and is the direct reason "never block zoom" is an absolute anti-pattern (§14).
- **Spacing:** Per `DESIGN_SYSTEM.md` §6 — adequate spacing supports both visual clarity and touch-target accessibility (motor accessibility, not only vision).
- **Focus Indicators:** Per `DESIGN_SYSTEM.md` §15 — visually clear, consistent, and never suppressed for aesthetic reasons; this is restated here because it is the single most commonly violated accessibility requirement across web products generally, and BARQ treats it as non-negotiable specifically because it's so easy to accidentally remove.
- **Dark Mode Readiness:** Not a V1 commitment (`DESIGN_SYSTEM.md` §20), but the color-role structure already established there anticipates it — this document adds only that any future Dark Mode palette must independently satisfy WCAG AA, not inherit compliance from the light-mode palette by assumption.

## 5. Keyboard Accessibility

- **Tab Order:** Follows the logical, visual reading order for the current language direction (`LOCALIZATION.md` §4) — RTL and LTR each have their own correct tab order, and neither is a mirrored assumption of the other without verification.
- **Focus Management:** After a dynamic UI change (a Dialog opening, a Toast appearing, a page transition), focus moves predictably to where a keyboard user would expect it — never left stranded on a now-hidden or removed element.
- **Keyboard Shortcuts:** If any exist, they must not conflict with browser or assistive-technology default shortcuts — specific shortcut definitions are an Open Decision (§15), not invented here.
- **Modal Navigation:** An open Dialog intentionally contains keyboard focus within itself while open — this is the correct accessible pattern, and is explicitly **not** the same thing as the "never trap keyboard users" anti-pattern in §14, which refers to *unintentional, inescapable* traps. A Dialog's focus containment is intentional, expected, and always paired with a clear, working way out (Escape, below, or a visible close action).
- **Escape Behavior:** The Escape key consistently closes the current Dialog or dismissible UI element, every time, across every module — consistency here is itself an accessibility property (§2).

## 6. Screen Reader Support

- **Semantic Structure:** Every screen uses real heading and landmark structure — never a styled `<div>` masquerading as a heading, which breaks screen-reader navigation even though it looks correct visually.
- **Accessible Labels:** Every interactive element (`DESIGN_SYSTEM.md` §7's icon-only controls, especially) carries a real, programmatically-associated label — visual clarity alone never satisfies this requirement.
- **ARIA Philosophy:** ARIA supplements native semantic HTML; it never replaces it where a native element would already do the job correctly. ARIA is reached for specifically to fill a genuine gap native elements can't cover, not applied broadly as a default layer — over-applied ARIA is its own accessibility risk (contradictory or redundant announcements), not a safety margin.
- **Announcements:** Dynamic content changes relevant to the user (a new Notification arriving, an AI response completing) are announced to assistive technology — calibrated so real information is announced without creating constant, fatiguing noise from every minor UI change.
- **Status Changes:** Booking status updates, Journey progress changes, and AI response states (§10) follow the same Announcements philosophy — a sighted user seeing a status change and a screen-reader user hearing about it should have equivalent awareness, not a degraded one.

## 7. RTL and Localization Accessibility

Governed jointly with `LOCALIZATION.md` §4/§12 — this section states the accessibility-specific implications in full:

- **RTL Navigation / LTR Navigation:** Tab order and screen-reader reading order both follow the correct logical order for the active direction (§5) — verified independently per direction, never assumed to mirror correctly by default.
- **Mixed Language Content:** Where Arabic and English appear together on the same screen (e.g. an English Provider business name inside an Arabic sentence), the underlying content must be language-tagged at the content level so assistive technology voices each span in the correct language and pronunciation — this is a real, specific requirement for a genuinely bilingual product, not a generic RTL concern.
- **Bidirectional Text:** Numbers and mixed-direction content within an RTL paragraph must maintain correct visual and logical order for both sighted and assistive-technology users — per `LOCALIZATION.md` §4's number-mirroring exception, applied here to the accessibility layer specifically.
- **Numbers:** Regardless of which numeral glyph set is eventually chosen (`LOCALIZATION.md` §15, still open), screen readers must announce numeric values correctly and unambiguously either way — this requirement holds independent of that still-open decision.
- **Maps:** A live-tracking map (`DESIGN_SYSTEM.md` §13) is inherently visual and needs a genuine non-visual equivalent, not just an alt-text label — the Timeline/Journey Progress pairing `DESIGN_SYSTEM.md` §13 already established (textual progress alongside the map) is exactly this equivalent, and this document confirms that pairing is an accessibility requirement, not only a design nicety.
- **Charts:** Any future data visualization (`DESIGN_SYSTEM.md` §7's iconography-adjacent territory, or a future Admin/Operations reporting view) needs an accessible data-table or textual-summary alternative — never a chart as the sole way to access the underlying information.

## 8. Forms

- **Validation:** Errors are announced to assistive technology at the moment they occur, not only shown visually (`DESIGN_SYSTEM.md` §11) — a sighted user seeing a red border and a screen-reader user hearing nothing is a real accessibility failure, not an acceptable partial implementation.
- **Clear Labels:** Every input has a real, programmatically-associated label — placeholder text is never used as a substitute for a label, since placeholder content disappears the moment a user starts typing and was never announced as a label in the first place.
- **Error Recovery:** An error states what's wrong and, where possible, how to fix it, and focus moves to the first error on a failed submission — consistent with `DESIGN_SYSTEM.md` §11's Errors philosophy, extended here with the specific focus-management requirement.
- **Required Fields:** Marked both visually and programmatically — never by color alone, per §14's anti-pattern.
- **Input Assistance:** Format hints (e.g. expected phone number format, per `LOCALIZATION.md` §6) and the OTP input pattern (`AUTHENTICATION.md` §10) are presented clearly and are themselves screen-reader accessible, not just visually well-designed.

## 9. Motion and Animation

- **Reduced Motion:** Every animation defined in `DESIGN_SYSTEM.md` §14 has a reduced-motion-respecting equivalent that activates automatically based on the user's system preference — restated here as binding, not optional, consistent with that document's own framing.
- **Loading States:** Loading indicators (`DESIGN_SYSTEM.md` §14) are announced to assistive technology, not only shown visually — a screen-reader user should know something is loading without needing to guess from silence.
- **Transitions:** Never the sole means of conveying that something changed — a transition supports a change a screen reader or reduced-motion user can also perceive through another signal (an announcement, a status label), never the only signal.
- **Progress Indicators:** Booking and Journey progress (§7) always have a non-animated, textual equivalent available — motion communicates progress for sighted users; text communicates the same fact for everyone.

## 10. AI Accessibility

Governed jointly with `AI_STRATEGY.md` §2 and `AI_AGENTS.md` §13–§14; this section states the accessibility-specific implications:

- **Accessible AI Conversations:** The Customer Assistant's chat interface (`AI_AGENTS.md` §4, `DESIGN_SYSTEM.md` §17) is fully keyboard-operable and screen-reader-friendly — a conversational interface is still an interface, subject to every principle above, not an exception to them.
- **Voice-Ready Future:** Not a V1 commitment (`AI_AGENTS.md` §16's Voice Agent remains directional), but designing AI conversations with clear, well-structured turn-taking now (§6's Announcements philosophy applied to conversation) makes a future voice interface a more natural extension rather than a redesign.
- **Explainability:** `AI_AGENTS.md` §14's Reasoning Summary, Confidence, and Sources must themselves be presented accessibly — an explanation only a sighted user can perceive isn't actually explainable to everyone the platform serves.
- **Human Escalation:** The escalation path (`AI_AGENTS.md` §13) is always keyboard-reachable and screen-reader-discoverable — never hidden behind a hover-only affordance or a visual-only cue, per §14's "never rely on hover only" anti-pattern applied specifically to the single most important AI-interaction control on the platform.
- **Confidence Presentation:** Per `API_CONTRACTS.md` §13 and `AI_AGENTS.md` §14 — confidence is never conveyed by color alone (§14); a textual or iconographic signal accompanies it, so the distinction between a recommendation and a retrieved fact is perceivable regardless of how a person accesses the interface.

## 11. Notifications

- **Accessible Alerts:** Per `DESIGN_SYSTEM.md` §8 — announced to assistive technology through an appropriate live-region-style pattern, calibrated per §6's Announcements philosophy.
- **Toast Messages:** Transient messages remain visible/available long enough to be read or announced — accessibility often requires a longer minimum duration, or a way to recall a dismissed message, rather than the fastest possible auto-dismiss.
- **Dialogs:** Governed by §5's Modal Navigation and Escape Behavior.
- **Status Indicators:** Per `DESIGN_SYSTEM.md` §8 — always paired with an icon and/or label, never color alone (§14), restated here because Status Indicators are the platform's single most-reused component and therefore the highest-leverage place to get this right.
- **Priority:** Urgent notifications (e.g. a safety-relevant Tracking alert) are distinguishable to assistive technology from routine informational ones — not every notification deserves the same level of interruption, for accessibility reasons as much as for good UX generally.

## 12. Performance and Accessibility

- **Slow Networks:** Given real variability in Oman/GCC mobile network conditions, accessibility-relevant dynamic updates (live regions, status announcements) must not degrade badly on a slow connection — an accessible feature that silently fails to update under poor connectivity is not actually accessible under those real conditions.
- **Low-End Devices:** Per `ARCHITECTURE_PRINCIPLES.md` Principle 9 (Mobile First) and Principle 26 (Cost-Aware Architecture) — accessibility accommodations (motion, live announcements) must perform acceptably on lower-end devices, not only on the device the design was tested on.
- **Offline Degradation:** Per `DESIGN_SYSTEM.md` §18's Offline empty state — the offline state itself must be communicated accessibly, not only through a visual icon a screen-reader user would miss entirely.
- **Progressive Enhancement:** Core content and functionality remain accessible even if an enhanced, JavaScript-dependent feature fails to load — baseline usability is never contingent on every enhancement succeeding.

## 13. Future Accessibility

Directional only, none committed for V1:

- **Voice Navigation:** Per §10's Voice-Ready Future note and `AI_AGENTS.md` §16 — contingent on the Voice Agent becoming real.
- **Accessibility Profiles:** A candidate future capability letting a user save accessibility preferences (larger text, reduced motion) beyond what their OS-level settings already provide — not designed in detail here (§15).
- **Personalization:** A candidate future adaptive-UI direction based on demonstrated user needs over time — genuinely speculative at this stage.
- **Government Compliance:** Oman/GCC-specific accessibility regulation, if and where it exists or emerges, is owned by future `COMPLIANCE_AND_LEGAL.md` — this document's WCAG AA target (§3) is treated as the working baseline until/unless a specific government standard requires more.

## 14. Anti-Patterns

Explicitly forbidden, without exception:

- Never use color alone — every semantic or status signal (§4, §11) pairs color with an icon, label, or text.
- Never trap keyboard users — unintentionally, that is; intentional, escapable modal focus containment (§5) is the correct pattern, not a violation of this rule.
- Never hide focus — focus indicators (§4) are never suppressed for visual preference.
- Never autoplay important actions — nothing consequential (a Booking confirmation, a Payment) proceeds automatically without a deliberate user action, for accessibility and trust reasons alike.
- Never block zoom — text and layout scaling (§4) must remain available; disabling pinch-zoom or fixed viewport scaling is forbidden.
- Never rely on hover only — every hover-revealed affordance (§10's escalation path is the highest-stakes example) has a keyboard- and touch-accessible equivalent, since hover doesn't meaningfully exist on touch devices or for keyboard-only users.

## 15. Open Decisions

Intentionally deferred — not invented here:

1. **Specific keyboard shortcut set, if any** (§5) — not defined; would need its own conflict-check against browser/assistive-technology defaults before adoption.
2. **Live-region announcement verbosity tuning** (§6, §11) — the balance between informative and fatiguing is a real tuning decision, not fixed here.
3. **Accessibility Profiles feature scope and timing** (§13) — directional only.
4. **Applicable government accessibility standard, if any, for Oman/GCC specifically** (§13) — not identified yet; deferred to `COMPLIANCE_AND_LEGAL.md`.
5. **Dark Mode palette accessibility verification process** (§4) — deferred until Dark Mode itself is scheduled.

---

## Related Documents
- `PROJECT_MANIFEST.md` — Quality Standard §11, the founding commitment this document extends to accessibility
- `ARCHITECTURE_PRINCIPLES.md` — Principle 14, the architectural principle this document is the full elaboration of
- `DESIGN_SYSTEM.md` §7–§8, §11, §14–§18 — the component-level accessibility requirements this document provides the fuller architecture for
- `LOCALIZATION.md` §4, §12 — governs §7 in full; this document does not restate its RTL/LTR or fallback rules, only their accessibility implications
- `AI_STRATEGY.md` §2, `AI_AGENTS.md` §13–§14 — governing §10 in full
- `AUTHENTICATION.md` §10 — the OTP/UX pattern §8's Input Assistance references
- `API_CONTRACTS.md` §13 — Confidence presentation requirements referenced in §10
- `COMPLIANCE_AND_LEGAL.md` *(not yet written)* — will own Government Compliance (§13)

## Open Questions
1. Should this document eventually define a specific accessibility testing/verification process (automated + manual audit cadence), or does that belong to `TESTING_STRATEGY.md` (not yet written) instead? Flagged, not decided here — a sequencing question, not an accessibility-architecture question.
2. `DESIGN_SYSTEM.md` §22's Open Decision on Arabic numeral presentation (Western vs. Eastern Arabic numerals) has a real accessibility dimension (§7's Numbers note) that wasn't explicitly weighed when that decision was first flagged — should accessibility be added as an explicit input to that decision when it's eventually made? Flagged for whoever resolves it, not decided here.

## Future ADR References
- Any future decision to target a higher standard than WCAG AA (e.g. AAA for specific critical flows) or a specific government accessibility regulation (§13) as a binding requirement would raise this document's floor and should be recorded as an ADR, not a routine revision.
- Any future decision to relax any anti-pattern in §14 for a specific feature would require a superseding ADR, consistent with how this project treats every other absolute list of forbidden patterns (`ADR-0008`'s treatment of AI boundaries is the direct precedent).
