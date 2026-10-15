import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isCustomerBottomNavSurface } from "@/components/layout/bottom-nav-tabs";

// 2026-10-15 — provider vehicle action bars: the COMPLETE parent / scroll-owner contract, not just the
// word "sticky". Vitest runs without a browser layout engine, so the contract is asserted on the real
// source + stylesheet; the measured behaviour (bar pinned to the viewport bottom while the long form
// scrolls, document as the only scroll owner) is recorded in docs/project-memory/17 (2026-10-15).

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const code = (rel: string) => read(rel).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const SHELL = code("src/components/app-shell/app-shell.tsx");
const SIDEBAR = code("src/components/app-shell/app-sidebar.tsx");
const MOBILE_NAV = code("src/components/app-shell/app-mobile-nav.tsx");
const DIALOG = code("src/components/ui/dialog.tsx");
const BAR = code("src/components/provider/registration-review/sticky-action-bar.tsx");
const CSS = read("src/app/globals.css");
const SERVICE_VIEW = code("src/components/services/service-detail-view.tsx");
const FORMS = {
  onboarding: code("src/app/[locale]/provider/vehicles/new/[vehicleId]/_components/onboarding-review-form.tsx"),
  detail: code("src/app/[locale]/provider/vehicles/[id]/_components/registration-confirmation-form.tsx"),
  upload: code("src/app/[locale]/provider/vehicles/new/_components/registration-upload-form.tsx"),
};
/** The scoped rule block (selector → declarations). */
const rule = (selector: string) => {
  const i = CSS.indexOf(selector);
  expect(i, selector).toBeGreaterThan(-1);
  return CSS.slice(i, CSS.indexOf("}", i) + 1);
};

describe("1–3. one intended vertical scroll owner: the document (viewport)", () => {
  it("the shell is NOT height-constrained — the document scrolls on every AppShell page (unchanged for every consumer)", () => {
    expect(SHELL).toMatch(/<div className="min-h-screen bg-background">/);
    expect(SHELL).not.toMatch(/(?<!min-)h-screen|h-dvh|h-svh|overflow-hidden/);
    // the shell's <main> is left exactly as it was for every page WITHOUT a provider action bar
    expect(SHELL).toContain('<main id="main-content" className="flex-1 overflow-y-auto">{children}</main>');
  });

  it("only a page that renders a marked action bar turns <main> from an (inert) scroll box into normal flow: no vertical overflow handling, horizontal clip, can shrink", () => {
    const r = rule("#main-content:has([data-provider-action-bar]) {");
    expect(r).toMatch(/min-width: 0;/);
    expect(r).toMatch(/overflow: visible;/);
    expect(r).toMatch(/overflow-x: clip;/); // clip is NOT a scroll container, so sticky resolves against the viewport
    expect(r).not.toMatch(/overflow-y: (auto|scroll|hidden)|height:/);
  });

  it("12. pages without an action bar are untouched — including service previews whose own sticky elements must stay inert inside the shell", () => {
    expect(CSS.match(/#main-content[^{]*\{/g)).toEqual(["#main-content:has([data-provider-action-bar]) {"]);
    expect(SERVICE_VIEW).not.toMatch(/data-provider-action-bar|StickyActionBar/);
  });
});

describe("4/5/8. the action bar component and its three users", () => {
  it("the ONE bar: marked, sticky against the viewport below sm, static from sm, in normal flow (never fixed)", () => {
    expect(BAR).toMatch(/data-provider-action-bar=""/);
    expect(BAR).toMatch(/className=\{`sticky bottom-0 sm:static \$\{className\}`\}/);
    expect(BAR).not.toMatch(/\bfixed\b|\babsolute\b|z-\d/);
  });

  it.each(Object.entries(FORMS))("%s form renders exactly one StickyActionBar and no other sticky / fixed bar", (_name, src) => {
    expect((src.match(/<StickyActionBar /g) ?? []).length).toBe(1);
    expect((src.match(/<\/StickyActionBar>/g) ?? []).length).toBe(1);
    expect(src).not.toMatch(/className="[^"]*\bsticky\b|fixed inset-x-0 bottom-0|fixed bottom-0/);
    expect(src).toMatch(/import \{ StickyActionBar \} from "@\/components\/provider\/registration-review\/sticky-action-bar";/);
  });
});

describe("6/7/13. safe area, terminal space, focus above the bar", () => {
  it.each(Object.entries(FORMS))("%s bar keeps the Safari safe-area bottom padding", (_name, src) => {
    expect(src).toMatch(/<StickyActionBar className="[^"]*pb-\[max\(env\(safe-area-inset-bottom\),0\.75rem\)\]/);
  });

  it("the bar publishes its MEASURED height (no hard-coded offset) and removes it when it unmounts", () => {
    expect(BAR).toMatch(/export const ACTION_BAR_HEIGHT_PROPERTY = "--provider-action-bar-height";/);
    expect(BAR).toMatch(/root\.style\.setProperty\(ACTION_BAR_HEIGHT_PROPERTY, `\$\{Math\.ceil\(el\.getBoundingClientRect\(\)\.height\)\}px`\)/);
    expect(BAR).toMatch(/new ResizeObserver\(write\)/);
    expect(BAR).toMatch(/observer\.disconnect\(\);\s*root\.style\.removeProperty\(ACTION_BAR_HEIGHT_PROPERTY\);/);
  });

  it("below sm the document's scroll-padding reserves the bar height, so a focused / scrolled-to field lands above it; desktop is untouched", () => {
    const media = CSS.slice(CSS.indexOf("@media (max-width: 639px) {"));
    expect(media).toMatch(/^@media \(max-width: 639px\) \{\s*html:has\(\[data-provider-action-bar\]\) \{\s*scroll-padding-bottom: calc\(var\(--provider-action-bar-height, 12rem\) \+ 1rem\);/);
  });

  it("the forms still bring the first invalid private field into view (block: center) — the scroll owner is the document they scroll", () => {
    for (const src of [FORMS.onboarding, FORMS.detail]) expect(src).toMatch(/scrollIntoView\(\{ block: "center", behavior: "smooth" \}\)/);
  });
});

describe("9/10/11. stacking, app navigation, desktop", () => {
  it("dialogs (language switch / confirmations) and the provider mobile menu are fixed overlays above the bar (z-50; the bar sets no z-index)", () => {
    expect(DIALOG).toMatch(/className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"/);
    expect(MOBILE_NAV).toMatch(/className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog"/);
  });

  it("the customer bottom navigation never renders on provider routes, so nothing sits under the bar there", () => {
    for (const p of ["/provider", "/provider/vehicles/new", "/provider/vehicles/x", "/provider/vehicles/new/x"]) expect(isCustomerBottomNavSurface(p)).toBe(false);
  });

  it("desktop sidebar / header are unchanged: sidebar only from md, bar static from sm (it cannot stretch across the sidebar)", () => {
    expect(SIDEBAR).toMatch(/className="hidden flex-col bg-card px-4 py-8 md:flex"/);
    expect(SHELL).toMatch(/<div className="flex">\s*<AppSidebar/);
  });
});

describe("14. no horizontal overflow at 375px", () => {
  it("<main> clips horizontally and can shrink; the bars bleed only by the page gutter (-mx-4 ↔ px-4)", () => {
    const r = rule("#main-content:has([data-provider-action-bar]) {");
    expect(r).toMatch(/overflow-x: clip;/);
    expect(r).toMatch(/min-width: 0;/);
    for (const src of Object.values(FORMS)) expect(src).toMatch(/<StickyActionBar className="-mx-4 [^"]*px-4 /);
  });
});
