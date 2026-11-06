import { test, expect, type Page } from "@playwright/test";

// BARQ design lab — LAYOUT GUARD for large text (owner correction 2026-10-26). Measures, on the three
// composed screens (consent · vehicle review · trip plan) in their default / error / disabled states,
// Arabic + English, 375 × 812 and 430 × 932, root text 100 / 150 / 200 %:
//   1. no horizontal overflow;
//   2. a sticky action bar is at most 30 % of the phone screen height;
//   3. every button / field / link of the page content can be scrolled fully into the area between
//      the sticky header and the sticky bar / bottom nav (nothing lives behind the bar);
//   4. keyboard focus never leaves the focused control hidden behind a sticky bar (Tab traversal);
//   5. the last content element ends above the bar / nav and the iPhone home-indicator inset, and the
//      bar's own controls end above that inset (emulated: --ds-test-safe-bottom = 34 px);
//   6. bottom-nav labels are never clipped or truncated (≤ 2 lines), and every destination stays
//      reachable (directly or through "More").
// Owner correction 2026-10-31:
//   7. PERSISTENT CHROME — what actually stays on screen while the page scrolls (elements whose
//      viewport position does not move between scroll positions), home-indicator inset included — is
//      at most 25 % of the screen; a header that scrolls away is not counted;
//   8. no clipped text anywhere (overflow hidden / ellipsis / line clamp hiding content), and the screen
//      title is never truncated or shrunk;
//   9. the "More" bottom sheet (large text): ≤ 70 % of the screen, full labels, internal scrolling,
//      focus trapped and never hidden, opened / closed by touch (button, backdrop, close, destination)
//      and keyboard (Enter, Escape, close button), focus back on "More", nothing left covering the page;
//  10. on-screen keyboard: the viewport is shrunk in Chromium (an emulation, NOT a substitute for a real
//      iPhone, where the layout viewport does not shrink the same way) — the focused control stays
//      visible above the sticky bar / nav and nothing overflows.
// Metrics are attached to each test (annotation "layout") so before / after can be compared.

const SAFE_BOTTOM = 34;
/** Emulated on-screen keyboard height (iPhone keyboard + suggestion bar, rounded up). */
const KEYBOARD = 336;
const PHONES = [
  { w: 375, h: 812 },
  { w: 430, h: 932 },
];

const SCREENS: { id: string; state: "default" | "error" | "disabled" | "empty" }[] = [
  { id: "prototypes-1-vehicle-reading-consent--confirmed-details-open", state: "default" },
  { id: "prototypes-1-vehicle-reading-consent--reading-failed", state: "error" },
  { id: "prototypes-1-vehicle-reading-consent--choose", state: "disabled" },
  { id: "prototypes-2-vehicle-review--ready", state: "default" },
  { id: "prototypes-2-vehicle-review--save-error", state: "error" },
  { id: "prototypes-2-vehicle-review--needs-review", state: "disabled" },
  { id: "prototypes-3-trip-plan--mixed", state: "default" },
  { id: "prototypes-3-trip-plan--rate-limited", state: "error" },
  { id: "prototypes-3-trip-plan--no-services", state: "empty" },
  // large-text bar options A / B (measured side by side; A is the chosen default)
  { id: "prototypes-1-vehicle-reading-consent--large-text-option-a", state: "disabled" },
  { id: "prototypes-1-vehicle-reading-consent--large-text-option-b", state: "disabled" },
  { id: "prototypes-2-vehicle-review--large-text-option-a", state: "disabled" },
  { id: "prototypes-2-vehicle-review--large-text-option-b", state: "disabled" },
];

type Metrics = {
  overflowX: number;
  barRatio: number | null;
  barSticky: boolean;
  headerH: number;
  hiddenControls: string[];
  focusHidden: string[];
  lastGap: number | null;
  barControlsAboveSafe: boolean | null;
  navRatio: number | null;
  navClipped: string[];
  navMaxLines: number | null;
  navDestinations: number | null;
  /** comparison metrics: primary action fully visible at scroll 0, scroll needed to reach it, share of the screen left for content */
  primaryAtTop: boolean | null;
  scrollToPrimary: number | null;
  contentRatio: number;
  /** share of the screen covered by elements that stay put while the page scrolls */
  persistentChrome: number;
  clippedText: string[];
  /** screen title: clipped / truncated, and its font size vs the type scale (px) */
  title: { clipped: boolean; fontPx: number; expectedPx: number } | null;
};

/**
 * 7 · Persistent chrome: scrolls the page to several positions; an element counts when it is sticky /
 * fixed, on screen, AND keeps its viewport position between two scroll positions (it is stuck). The
 * covered height is the union of those elements' vertical extents (no double counting); worst case.
 */
async function persistentChrome(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const vh = innerHeight;
    const max = document.documentElement.scrollHeight - vh;
    const pinned = [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => ["sticky", "fixed"].includes(getComputedStyle(el).position));
    const covered = (rects: DOMRect[]) => {
      const iv = rects.filter((r) => r.height > 0 && r.width > 0 && r.bottom > 0 && r.top < vh).map((r) => [Math.max(0, r.top), Math.min(vh, r.bottom)] as const).sort((a, b) => a[0] - b[0]);
      let total = 0;
      let end = -Infinity;
      for (const [s, e] of iv) {
        if (e <= end) continue;
        total += e - Math.max(s, end);
        end = e;
      }
      return total / vh;
    };
    let worst = 0;
    if (max < 8) {
      // nothing scrolls: every pinned element on screen counts
      worst = covered(pinned.map((el) => el.getBoundingClientRect()));
    } else {
      const stops = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
      for (let i = 1; i < stops.length; i++) {
        window.scrollTo(0, stops[i - 1]!);
        await frame();
        const before = pinned.map((el) => el.getBoundingClientRect().top);
        window.scrollTo(0, stops[i]!);
        await frame();
        const stuck = pinned.map((el) => el.getBoundingClientRect()).filter((r, k) => Math.abs(r.top - before[k]!) < 1);
        worst = Math.max(worst, covered(stuck));
      }
    }
    window.scrollTo(0, 0);
    await frame();
    return Math.round(worst * 1000) / 1000;
  });
}

/** 8 · Text hidden by its box: overflow hidden / clip, an ellipsis or a line clamp (visually-hidden helpers excluded). */
async function clippedText(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1 || !(el.textContent ?? "").trim()) return false;
        const cs = getComputedStyle(el);
        const clipX = ["hidden", "clip"].includes(cs.overflowX) || cs.textOverflow === "ellipsis";
        const clipY = ["hidden", "clip"].includes(cs.overflowY) || (cs.getPropertyValue("-webkit-line-clamp") || "none") !== "none";
        return (clipX && el.scrollWidth > el.clientWidth + 1) || (clipY && el.scrollHeight > el.clientHeight + 1);
      })
      .map((el) => `${el.tagName.toLowerCase()}:${(el.textContent ?? "").trim().slice(0, 28)}`),
  );
}

async function titleCheck(page: Page): Promise<Metrics["title"]> {
  return page.evaluate(() => {
    const t = document.querySelector<HTMLElement>("[data-ds-screen-title]");
    if (!t) return null;
    const cs = getComputedStyle(t);
    const clipped = t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1 || cs.textOverflow === "ellipsis" || cs.whiteSpace === "nowrap";
    // the type scale's 1.0625rem at the root size actually in effect (a story may pin its own text size)
    const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return { clipped, fontPx: parseFloat(cs.fontSize), expectedPx: Math.round(1.0625 * root * 100) / 100 };
  });
}

async function open(page: Page, id: string, locale: string, scale: string) {
  await page.goto(`/iframe.html?id=${id}&viewMode=story&globals=locale:${locale};textScale:${scale}`);
  await page.waitForSelector("#storybook-root > *", { timeout: 20_000 });
  await page.evaluate(async (safe) => {
    document.documentElement.style.setProperty("--ds-test-safe-bottom", `${safe}px`);
    await document.fonts.ready;
  }, SAFE_BOTTOM);
  await page.waitForTimeout(200);
}

/** Sticky elements of the screen: header (top), action bar (bottom, not nav), bottom nav. */
async function measure(page: Page): Promise<Metrics> {
  return page.evaluate(async (safe) => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const root = document.querySelector("#storybook-root")!;
    const all = [...root.querySelectorAll<HTMLElement>("*")];
    const sticky = all.filter((el) => getComputedStyle(el).position === "sticky" && el.getBoundingClientRect().height > 0);
    const header = sticky.find((el) => getComputedStyle(el).top === "0px") ?? null;
    const nav = sticky.find((el) => el.tagName === "NAV" && getComputedStyle(el).bottom === "0px") ?? null;
    // the VISIBLE bar (a hidden desktop-aside copy must not be measured instead)
    const shown = (el: HTMLElement) => el.getClientRects().length > 0 && el.getBoundingClientRect().height > 0;
    const bar = ([...root.querySelectorAll<HTMLElement>("[data-ds-sticky-bar]")].find(shown) ?? sticky.find((el) => el.tagName !== "NAV" && getComputedStyle(el).bottom === "0px")) || null;
    const barSticky = !!bar && getComputedStyle(bar).position === "sticky";
    const vh = innerHeight;
    window.scrollTo(0, 0);
    await frame();
    const headerH = header ? header.getBoundingClientRect().height : 0;
    const barH = bar && barSticky ? bar.getBoundingClientRect().height : 0;
    const navH = nav ? nav.getBoundingClientRect().height : 0;
    const bottomObstruction = () => {
      const tops = [vh - safe];
      if (bar && barSticky) tops.push(bar.getBoundingClientRect().top);
      if (nav) tops.push(nav.getBoundingClientRect().top);
      return Math.min(...tops);
    };
    // primary action of a task screen = first visible button of the visible bar
    const primaryBtn = bar ? ([...bar.querySelectorAll<HTMLElement>("button")].find((b) => b.getBoundingClientRect().height > 0) ?? null) : null;
    const pr = primaryBtn ? primaryBtn.getBoundingClientRect() : null;
    const primaryAtTop = pr ? pr.top >= headerH - 0.5 && pr.bottom <= vh - safe + 0.5 : null;
    const scrollToPrimary = pr ? Math.max(0, Math.round(pr.bottom - (vh - safe))) : null;
    const contentRatio = Math.round(((Math.min(vh - safe, bar && barSticky ? bar.getBoundingClientRect().top : vh, nav ? nav.getBoundingClientRect().top : vh) - headerH) / vh) * 1000) / 1000;
    const name = (el: HTMLElement) => `${el.tagName.toLowerCase()}:${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 28)}`;
    const visible = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    const inside = (el: HTMLElement, box: HTMLElement | null) => !!box && box.contains(el);

    // 3 · every content control can be scrolled fully into the unobstructed area
    const controls = [...root.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, summary")].filter((el) => visible(el) && !inside(el, header) && !inside(el, nav) && !(barSticky && inside(el, bar)));
    const hiddenControls: string[] = [];
    const maxScroll = () => document.documentElement.scrollHeight - vh;
    for (const el of controls) {
      const abs = el.getBoundingClientRect().top + scrollY;
      const h = el.getBoundingClientRect().height;
      // bottom-anchored: scroll so the control sits just above the bottom obstruction
      window.scrollTo(0, Math.max(0, Math.min(maxScroll(), abs + h - bottomObstruction() + 4)));
      await frame();
      let r = el.getBoundingClientRect();
      let ok = r.top >= headerH - 0.5 && r.bottom <= bottomObstruction() + 0.5;
      if (!ok) {
        window.scrollTo(0, Math.max(0, Math.min(maxScroll(), abs - headerH - 4)));
        await frame();
        r = el.getBoundingClientRect();
        ok = r.top >= headerH - 0.5 && r.bottom <= bottomObstruction() + 0.5;
      }
      if (!ok) hiddenControls.push(name(el));
    }

    // 5 · last content element (at maximum scroll) ends above the bar / nav / safe area
    window.scrollTo(0, maxScroll());
    await frame();
    const main = root.querySelector<HTMLElement>("main");
    const lastEl = main ? ([...main.querySelectorAll<HTMLElement>("*")].filter(visible).pop() ?? main) : null;
    const lastGap = lastEl ? Math.round(bottomObstruction() - lastEl.getBoundingClientRect().bottom) : null;
    let barControlsAboveSafe: boolean | null = null;
    if (bar) {
      const ctrls = [...bar.querySelectorAll<HTMLElement>("button, a[href]")].filter(visible);
      barControlsAboveSafe = ctrls.every((c) => c.getBoundingClientRect().bottom <= vh - safe + 0.5);
    }
    window.scrollTo(0, 0);
    await frame();

    // 6 · bottom navigation labels
    let navClipped: string[] = [];
    let navMaxLines: number | null = null;
    let navDestinations: number | null = null;
    if (nav) {
      const labels = [...nav.querySelectorAll<HTMLElement>("[data-ds-nav-label], a > span:last-child, button > span:last-child")].filter(visible);
      // actually clipped (content wider / taller than its box) — an ellipsis style that never triggers is not clipping
      navClipped = labels.filter((l) => l.scrollWidth > l.clientWidth + 1 || l.scrollHeight > l.clientHeight + 1).map((l) => (l.textContent ?? "").trim());
      navMaxLines = Math.max(0, ...labels.map((l) => Math.round(l.getBoundingClientRect().height / parseFloat(getComputedStyle(l).lineHeight))));
      navDestinations = nav.querySelectorAll("a[href]").length;
    }
    return {
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      barRatio: bar ? Math.round((barH / vh) * 1000) / 1000 : null,
      barSticky,
      headerH: Math.round(headerH),
      hiddenControls,
      focusHidden: [],
      lastGap,
      barControlsAboveSafe,
      navRatio: nav ? Math.round((navH / vh) * 1000) / 1000 : null,
      navClipped,
      navMaxLines,
      navDestinations,
      primaryAtTop,
      scrollToPrimary,
      contentRatio,
      persistentChrome: 0,
      clippedText: [],
      title: null,
    };
  }, SAFE_BOTTOM);
}

/** 4 · Tab through the page: the focused control must not be hidden behind a sticky bar / nav. */
async function focusTraversal(page: Page): Promise<string[]> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  const hidden: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    // let the page react to focus (one-frame focus-visibility correction) before measuring
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const res = await page.evaluate((safe) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || !document.querySelector("#storybook-root")!.contains(el)) return { done: true, hidden: null as string | null };
      const root = document.querySelector("#storybook-root")!;
      const sticky = [...root.querySelectorAll<HTMLElement>("*")].filter((x) => getComputedStyle(x).position === "sticky" && x.getBoundingClientRect().height > 0);
      if (sticky.some((s) => s.contains(el))) return { done: false, hidden: null };
      const r = el.getBoundingClientRect();
      const top = Math.max(0, ...sticky.filter((s) => getComputedStyle(s).top === "0px").map((s) => s.getBoundingClientRect().bottom));
      const bottom = Math.min(innerHeight - safe, ...sticky.filter((s) => getComputedStyle(s).bottom === "0px").map((s) => s.getBoundingClientRect().top));
      const fully = r.top >= top - 0.5 && r.bottom <= bottom + 0.5;
      return { done: false, hidden: fully ? null : `${el.tagName.toLowerCase()}:${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 28)}` };
    }, SAFE_BOTTOM);
    if (res.done) break;
    if (res.hidden) hidden.push(res.hidden);
  }
  return [...new Set(hidden)];
}

/** "More" navigation (large text): every destination must be listed with its full label; closed again with Escape. */
async function moreMenu(page: Page): Promise<{ present: boolean; destinations: number; clipped: string[] }> {
  const more = page.locator("[data-ds-nav-more]");
  if ((await more.count()) === 0 || !(await more.first().isVisible())) return { present: false, destinations: 0, clipped: [] };
  await more.first().click();
  const found = await page.evaluate(() => {
    const sheet = document.querySelector<HTMLElement>("[data-ds-nav-sheet]");
    if (!sheet) return { present: true, destinations: 0, clipped: ["(sheet missing)"] };
    const links = [...sheet.querySelectorAll<HTMLElement>("a[href]")];
    const clipped = links.filter((l) => l.scrollWidth > l.clientWidth + 1).map((l) => (l.textContent ?? "").trim());
    return { present: true, destinations: links.length, clipped };
  });
  await page.keyboard.press("Escape");
  return found;
}

for (const s of SCREENS) {
  for (const locale of ["ar", "en"] as const) {
    for (const vp of PHONES) {
      for (const scale of ["100", "150", "200"]) {
        test(`layout · ${s.id} · ${s.state} · ${locale} ${vp.w} @${scale}%`, async ({ page }, info) => {
          test.skip(info.project.name !== "chromium", "chromium project only");
          await page.setViewportSize({ width: vp.w, height: vp.h });
          await open(page, s.id, locale, scale);
          const m = await measure(page);
          m.persistentChrome = await persistentChrome(page);
          m.clippedText = await clippedText(page);
          m.title = await titleCheck(page);
          m.focusHidden = await focusTraversal(page);
          const more = m.navDestinations !== null ? await moreMenu(page) : null;
          info.annotations.push({ type: "layout", description: JSON.stringify({ id: s.id, state: s.state, locale, vp: vp.w, scale, ...m, more }) });

          expect(m.overflowX, "horizontal overflow (px)").toBeLessThanOrEqual(1);
          expect(m.persistentChrome, "persistent chrome while scrolling / screen height").toBeLessThanOrEqual(0.25);
          expect(m.clippedText, "clipped text").toEqual([]);
          if (m.title) {
            expect(m.title.clipped, "screen title clipped / truncated").toBe(false);
            expect(Math.abs(m.title.fontPx - m.title.expectedPx), "screen title font size (never shrunk)").toBeLessThanOrEqual(0.5);
          }
          if (m.barRatio !== null && m.barSticky) expect(m.barRatio, "sticky bar height / screen height").toBeLessThanOrEqual(0.3);
          expect(m.hiddenControls, "controls that cannot be scrolled clear of the sticky bar / nav").toEqual([]);
          expect(m.focusHidden, "focused controls hidden behind a sticky bar / nav").toEqual([]);
          if (m.lastGap !== null) expect(m.lastGap, "last element ends above bar / nav / safe area (px)").toBeGreaterThanOrEqual(0);
          if (m.barControlsAboveSafe !== null) expect(m.barControlsAboveSafe, "bar controls above the home-indicator inset").toBe(true);
          if (m.navDestinations !== null) {
            expect(m.navClipped, "clipped / truncated nav labels").toEqual([]);
            expect(m.navMaxLines ?? 0, "nav label lines").toBeLessThanOrEqual(2);
            const reachable = Math.max(m.navDestinations, more?.present ? more.destinations : 0);
            expect(reachable, "navigation destinations reachable").toBeGreaterThanOrEqual(5);
            if (more?.present) expect(more.clipped, "clipped labels in More").toEqual([]);
          }
        });
      }
    }
  }
}

// ── 9 · "More" bottom sheet (exists in large text only: 150 / 200 %) ───────────────────────────────
const TRIP = "prototypes-3-trip-plan--mixed";

type SheetState = { open: boolean; ratio: number; heightPx: number; labels: string[]; clipped: string[]; activeInside: boolean; activeIsMore: boolean; layerLeft: boolean; bodyOverflow: string; closeVisible: boolean };

async function sheetState(page: Page): Promise<SheetState> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate(() => {
    const sheet = document.querySelector<HTMLElement>("[data-ds-sheet]");
    const active = document.activeElement as HTMLElement | null;
    const base = { activeIsMore: !!active?.hasAttribute("data-ds-nav-more"), layerLeft: !!document.querySelector("[data-ds-sheet-layer]"), bodyOverflow: document.body.style.overflow };
    if (!sheet) return { ...base, open: false, ratio: 0, heightPx: 0, labels: [], clipped: [], activeInside: false, closeVisible: false };
    const r = sheet.getBoundingClientRect();
    const texts = [...sheet.querySelectorAll<HTMLElement>("h2, [data-ds-sheet-label], [data-ds-sheet-close]")];
    const clipped = texts.filter((t) => t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1).map((t) => (t.textContent ?? "").trim());
    const close = sheet.querySelector<HTMLElement>("[data-ds-sheet-close]");
    return {
      ...base,
      open: true,
      ratio: Math.round((r.height / innerHeight) * 1000) / 1000,
      heightPx: Math.round(r.height),
      labels: [...sheet.querySelectorAll("[data-ds-sheet-label]")].map((l) => (l.textContent ?? "").trim()),
      clipped,
      activeInside: !!active && sheet.contains(active),
      closeVisible: !!close && close.getBoundingClientRect().height > 0 && (close.textContent ?? "").trim().length > 0,
    };
  });
}

/** The focused element is inside the sheet and fully visible in it (above the home-indicator inset). */
async function focusInSheet(page: Page): Promise<{ inside: boolean; visible: boolean; name: string }> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate((safe) => {
    const sheet = document.querySelector<HTMLElement>("[data-ds-sheet]");
    const el = document.activeElement as HTMLElement | null;
    const name = el ? `${el.tagName.toLowerCase()}:${(el.textContent ?? "").trim().slice(0, 28)}` : "(none)";
    if (!sheet || !el || !sheet.contains(el)) return { inside: false, visible: false, name };
    const r = el.getBoundingClientRect();
    const body = sheet.querySelector<HTMLElement>("[data-ds-sheet-body]")!;
    const box = body.contains(el) ? body.getBoundingClientRect() : sheet.getBoundingClientRect();
    const bottom = Math.min(box.bottom, innerHeight - safe);
    return { inside: true, visible: r.top >= box.top - 0.5 && r.bottom <= bottom + 0.5, name };
  }, SAFE_BOTTOM);
}

/** Nothing covers the element: the topmost element at its centre is the element itself (or inside it). */
async function uncovered(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((selector) => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && el.contains(hit);
  }, selector);
}

function expectClosed(s: SheetState) {
  expect(s.open, "sheet closed").toBe(false);
  expect(s.layerLeft, "no layer left covering the page").toBe(false);
  expect(s.activeIsMore, "focus back on More").toBe(true);
  expect(s.bodyOverflow, "page scroll unlocked").toBe("");
}

function expectOpenSheet(s: SheetState, vh: number) {
  expect(s.open, "sheet open").toBe(true);
  expect(s.heightPx, "sheet height ≤ 70 % of the screen (px)").toBeLessThanOrEqual(Math.ceil(vh * 0.7) + 0.5);
  expect(s.labels.length, "destinations in the sheet").toBe(5);
  expect(s.labels.every((l) => l.length > 0), "full destination labels").toBe(true);
  expect(s.clipped, "clipped sheet text").toEqual([]);
  expect(s.closeVisible, "visible close button").toBe(true);
  expect(s.bodyOverflow, "page scroll locked while open").toBe("hidden");
}

test.describe("9 · More bottom sheet — keyboard", () => {
  for (const locale of ["ar", "en"] as const) {
    for (const vp of PHONES) {
      for (const scale of ["150", "200"]) {
        test(`sheet · keyboard · ${locale} ${vp.w} @${scale}%`, async ({ page }, info) => {
          test.skip(info.project.name !== "chromium", "chromium project only");
          await page.setViewportSize({ width: vp.w, height: vp.h });
          await open(page, TRIP, locale, scale);
          const more = page.locator("[data-ds-nav-more]");
          await expect(more).toBeVisible();
          await more.focus();
          await page.keyboard.press("Enter");
          let s = await sheetState(page);
          info.annotations.push({ type: "sheet", description: JSON.stringify({ locale, vp: vp.w, scale, ratio: s.ratio, heightPx: s.heightPx }) });
          expectOpenSheet(s, vp.h);
          expect(s.activeInside, "focus moved into the sheet").toBe(true);

          // focus trap, both directions; each focused control fully visible inside the sheet
          const escaped: string[] = [];
          const hidden: string[] = [];
          for (const key of [...Array<string>(9).fill("Tab"), ...Array<string>(9).fill("Shift+Tab")]) {
            await page.keyboard.press(key);
            const f = await focusInSheet(page);
            if (!f.inside) escaped.push(`${key} → ${f.name}`);
            else if (!f.visible) hidden.push(f.name);
          }
          expect(escaped, "focus left the sheet").toEqual([]);
          expect(hidden, "focused controls hidden inside the sheet").toEqual([]);

          await page.keyboard.press("Escape");
          expectClosed(await sheetState(page));

          // Space opens; focus starts on the close button; Enter on it closes
          await page.keyboard.press("Space");
          s = await sheetState(page);
          expect(s.open, "sheet open (Space)").toBe(true);
          await expect(page.locator("[data-ds-sheet-close]")).toBeFocused();
          await page.keyboard.press("Enter");
          expectClosed(await sheetState(page));
          expect(await uncovered(page, "[data-ds-nav-more]"), "More not covered after closing").toBe(true);
        });
      }
    }
  }
});

test.describe("9 · More bottom sheet — touch", () => {
  test.use({ hasTouch: true });
  for (const locale of ["ar", "en"] as const) {
    for (const vp of PHONES) {
      for (const scale of ["150", "200"]) {
        test(`sheet · touch · ${locale} ${vp.w} @${scale}%`, async ({ page }, info) => {
          test.skip(info.project.name !== "chromium", "chromium project only");
          await page.setViewportSize({ width: vp.w, height: vp.h });
          await open(page, TRIP, locale, scale);
          const more = page.locator("[data-ds-nav-more]");

          // tap More → tap the dimmed backdrop above the sheet
          await more.tap();
          expectOpenSheet(await sheetState(page), vp.h);
          const top = (await page.locator("[data-ds-sheet]").boundingBox())!.y;
          expect(top, "backdrop visible above the sheet").toBeGreaterThan(40);
          await page.touchscreen.tap(vp.w / 2, Math.round(top / 2));
          expectClosed(await sheetState(page));

          // tap More → tap the close button
          await more.tap();
          await page.locator("[data-ds-sheet-close]").tap();
          expectClosed(await sheetState(page));

          // tap More → tap a destination
          await more.tap();
          await page.locator("[data-ds-nav-sheet] a[href]").last().tap();
          expectClosed(await sheetState(page));

          expect(await uncovered(page, "[data-ds-nav-more]"), "More not covered after closing").toBe(true);
          const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(overflowX, "horizontal overflow (px)").toBeLessThanOrEqual(1);
        });
      }
    }
  }
});

// ── 10 · On-screen keyboard: viewport shrink (Chromium emulation — NOT a substitute for a real iPhone) ──
const KEYBOARD_SCREENS = ["prototypes-1-vehicle-reading-consent--choose", "prototypes-2-vehicle-review--needs-review", "prototypes-2-vehicle-review--ready", TRIP];

test.describe("10 · on-screen keyboard (viewport shrink, Chromium emulation)", () => {
  for (const id of KEYBOARD_SCREENS) {
    for (const locale of ["ar", "en"] as const) {
      for (const vp of PHONES) {
        for (const scale of ["100", "150", "200"]) {
          test(`keyboard · ${id} · ${locale} ${vp.w} @${scale}%`, async ({ page }, info) => {
            test.skip(info.project.name !== "chromium", "chromium project only");
            await page.setViewportSize({ width: vp.w, height: vp.h });
            await open(page, id, locale, scale);
            // worst case: the first content control, scrolled so it sits just above the bar / nav — the
            // position a shrinking viewport buries first — then focused without scrolling
            const picked = await page.evaluate(async () => {
              const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
              const root = document.querySelector("#storybook-root")!;
              const main = root.querySelector("main")!;
              const el = [...main.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, select, textarea, summary")].find((x) => x.getBoundingClientRect().height > 0);
              if (!el) return null;
              const bottoms = [...root.querySelectorAll<HTMLElement>("*")].filter((x) => getComputedStyle(x).position === "sticky" && getComputedStyle(x).bottom === "0px" && x.getClientRects().length > 0);
              const limit = Math.min(innerHeight, ...bottoms.map((b) => b.getBoundingClientRect().top));
              window.scrollBy(0, el.getBoundingClientRect().bottom - (limit - 4));
              await frame();
              el.setAttribute("data-kb-target", "");
              el.focus({ preventScroll: true });
              await frame();
              return `${el.tagName.toLowerCase()}:${(el.textContent ?? "").trim().slice(0, 28)}`;
            });
            expect(picked, "a focusable content control").not.toBeNull();

            // keyboard opens: the viewport shrinks and the home-indicator inset is under the keyboard
            await page.evaluate(() => document.documentElement.style.setProperty("--ds-test-safe-bottom", "0px"));
            await page.setViewportSize({ width: vp.w, height: vp.h - KEYBOARD });
            await page.waitForTimeout(150);
            await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
            const r = await page.evaluate(() => {
              const el = document.querySelector<HTMLElement>("[data-kb-target]")!;
              const root = document.querySelector("#storybook-root")!;
              const sticky = [...root.querySelectorAll<HTMLElement>("*")].filter((x) => getComputedStyle(x).position === "sticky" && x.getClientRects().length > 0 && !x.contains(el));
              const top = Math.max(0, ...sticky.filter((s) => getComputedStyle(s).top === "0px").map((s) => s.getBoundingClientRect().bottom));
              const bottom = Math.min(innerHeight, ...sticky.filter((s) => getComputedStyle(s).bottom === "0px").map((s) => s.getBoundingClientRect().top));
              const b = el.getBoundingClientRect();
              return {
                focused: document.activeElement === el,
                visible: b.top >= top - 0.5 && b.bottom <= bottom + 0.5,
                overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              };
            });
            const chrome = await persistentChrome(page);
            info.annotations.push({ type: "keyboard", description: JSON.stringify({ id, locale, vp: vp.w, scale, height: vp.h - KEYBOARD, picked, ...r, chrome }) });
            expect(r.focused, "focus kept").toBe(true);
            expect(r.visible, `focused control (${picked}) visible above the bar / nav with the keyboard open`).toBe(true);
            expect(r.overflowX, "horizontal overflow (px)").toBeLessThanOrEqual(1);
          });
        }
      }
    }
  }
});
