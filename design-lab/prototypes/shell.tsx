import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Bell, Compass, Home, Menu, UserRound, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { clsx } from "@/components/ui/clsx";
import { useLabCopy } from "../copy";
import { FOCUS_RING } from "../tokens";

// Prototype shells (Storybook only). Both are `ds-shell` containers: below 22rem of width (a phone at
// 150 % text or more) the large-text layout of design-lab/lab.css applies.
//   TaskShell   — task screens (vehicle journey): back + task title + language; NO bottom nav and no
//                 footer; the sticky action bar is the only bottom element. Large text (bar mode A): the
//                 page gets an action area (`inlineActions`) before the bar, holding the status line and
//                 the secondary actions, so the sticky bar keeps the primary action only. From 1024 px
//                 the actions move into a side panel (`aside`).
//   BrowseShell — browse screens (trip plan): title + language; 5-tab bottom nav on phones. Large text:
//                 Home + the current tab + "More", which lists every destination with its full label.

function LanguageLink() {
  const other = useLocale() === "en" ? "العربية" : "English";
  return (
    <a href="#language" className={`inline-flex min-h-11 items-center rounded-xl px-3 text-[1rem] font-medium text-foreground/70 hover:bg-[#EEF4F8] ${FOCUS_RING}`}>
      {other}
    </a>
  );
}

/**
 * WCAG 2.4.11 (focus not obscured): a control that receives keyboard focus is scrolled clear of the
 * sticky header, the sticky bar / bottom nav and the home-indicator inset. Browsers do not reliably
 * apply scroll-padding when focus moves, so the shell corrects it one frame after `focusin`.
 */
function useKeepFocusVisible() {
  useEffect(() => {
    // reads max(env(safe-area-inset-bottom), --ds-test-safe-bottom) — env() is not readable from JS directly
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding-bottom:max(env(safe-area-inset-bottom),var(--ds-test-safe-bottom,0px))";
    document.body.appendChild(probe);
    const onFocus = (event: FocusEvent) => {
      const el = event.target;
      if (!(el instanceof HTMLElement)) return;
      requestAnimationFrame(() => {
        const sticky = [...document.querySelectorAll<HTMLElement>("[data-ds-sticky-header], [data-ds-sticky-bar], [data-ds-sticky-nav]")].filter((s) => s.getClientRects().length > 0 && getComputedStyle(s).position === "sticky" && !s.contains(el));
        const top = Math.max(0, ...sticky.filter((s) => s.hasAttribute("data-ds-sticky-header")).map((s) => s.getBoundingClientRect().bottom));
        const safe = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
        const bottom = Math.min(innerHeight - safe, ...sticky.filter((s) => !s.hasAttribute("data-ds-sticky-header")).map((s) => s.getBoundingClientRect().top));
        const r = el.getBoundingClientRect();
        if (r.bottom > bottom) window.scrollBy(0, r.bottom - bottom + 8);
        else if (r.top < top) window.scrollBy(0, r.top - top - 8);
      });
    };
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("focusin", onFocus);
      probe.remove();
    };
  }, []);
}

/** Publishes the sticky header's height (--ds-header-h) for scroll-padding. */
function useStickyHeaderHeight() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const write = () => root.style.setProperty("--ds-header-h", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    write();
    const observer = new ResizeObserver(write);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--ds-header-h");
    };
  }, []);
  return ref;
}

export function TaskShell({ title, backLabel, children, bar, aside, inlineActions }: { title: ReactNode; backLabel: string; children: ReactNode; bar?: ReactNode; aside?: ReactNode; inlineActions?: ReactNode }) {
  const rtl = useLocale() !== "en";
  const Back = rtl ? ArrowRight : ArrowLeft;
  const header = useStickyHeaderHeight();
  useKeepFocusVisible();
  return (
    <div className="ds-shell flex min-h-screen flex-col bg-background">
      <header ref={header} data-ds-sticky-header="" className="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b border-foreground/10 bg-background/95 px-2 backdrop-blur lg:px-8">
        <a href="#back" aria-label={backLabel} className={`flex size-11 items-center justify-center rounded-xl text-primary hover:bg-[#EEF4F8] ${FOCUS_RING}`}>
          <Back className="ds-icon" aria-hidden />
        </a>
        <span className="min-w-0 flex-1 text-[1.0625rem] font-semibold">{title}</span>
        <LanguageLink />
      </header>
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col lg:flex-row lg:items-start lg:gap-6 lg:px-8 lg:py-8">
        <main className="flex min-w-0 flex-1 flex-col gap-4 px-4 pb-6 pt-5 lg:px-0 lg:pt-0">
          {children}
          {/* Large text only (bar mode A): status + secondary actions live in the page, before the bar. */}
          {inlineActions && <div className="ds-only-large flex-col gap-3 rounded-[1.25rem] border border-foreground/10 bg-card p-5">{inlineActions}</div>}
        </main>
        {aside && <aside className="hidden w-[21rem] shrink-0 lg:sticky lg:top-24 lg:flex lg:flex-col lg:gap-3">{aside}</aside>}
      </div>
      {/* `contents`: the wrapper is not a box, so the bar stays sticky against the page scroll. */}
      {bar && <div className={clsx("contents", aside ? "lg:hidden" : undefined)}>{bar}</div>}
    </div>
  );
}

export function BrowseShell({ title, children }: { title: ReactNode; children: ReactNode }) {
  // The same keys as the app's bottom nav (customer-bottom-nav.tsx); "More" is proposed lab copy.
  const t = useTranslations("landing");
  const c = useLabCopy();
  const header = useStickyHeaderHeight();
  useKeepFocusVisible();
  const nav = useRef<HTMLElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const sheetId = useId();
  const tabs = [
    { key: "home", icon: Home, label: t("nav.home") },
    { key: "explore", icon: Compass, label: t("nav.explore"), active: true },
    { key: "bookings", icon: CalendarDays, label: t("nav.bookings") },
    { key: "notifications", icon: Bell, label: t("nav.notifications") },
    { key: "account", icon: UserRound, label: t("nav.account") },
  ];
  // Large text: Home, the current tab (if it is not Home) and "More".
  const compact = tabs.filter((x) => x.key === "home" || x.active);

  useEffect(() => {
    const el = nav.current;
    if (!el) return;
    const root = document.documentElement;
    const write = () => root.style.setProperty("--ds-bottom-h", getComputedStyle(el).display === "none" ? "0px" : `${Math.ceil(el.getBoundingClientRect().height)}px`);
    write();
    const observer = new ResizeObserver(write);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--ds-bottom-h");
    };
  }, []);

  const tab = (x: (typeof tabs)[number]) => (
    <a key={x.key} href={`#${x.key}`} aria-current={x.active ? "page" : undefined} className={clsx("flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-1.5 text-center text-[0.8125rem] leading-[1.45]", x.active ? "font-bold text-primary" : "font-medium text-foreground/70", FOCUS_RING)}>
      <span className={clsx("flex w-full max-w-[3.5rem] items-center justify-center rounded-full py-1", x.active && "bg-[#EEF4F8]")}>
        <x.icon className="ds-icon" aria-hidden />
      </span>
      {/* Never truncated: wraps (max two lines are measured by the layout guard). */}
      <span data-ds-nav-label="" className="block max-w-full">
        {x.label}
      </span>
    </a>
  );

  return (
    <div className="ds-shell flex min-h-screen flex-col bg-background">
      <header ref={header} data-ds-sticky-header="" className="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b border-foreground/10 bg-background/95 px-4 backdrop-blur lg:px-8">
        <span className="min-w-0 flex-1 text-[1.0625rem] font-semibold">{title}</span>
        <LanguageLink />
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 pb-6 pt-5 lg:pt-8">{children}</main>
      <nav ref={nav} data-ds-sticky-nav="" aria-label={t("nav.marketplaceNavLabel")} className="sticky bottom-0 z-20 flex flex-col border-t border-foreground/10 bg-background/95 pb-[max(env(safe-area-inset-bottom),var(--ds-test-safe-bottom,0px))] backdrop-blur lg:hidden">
        {moreOpen && (
          <ul id={sheetId} data-ds-nav-sheet="" aria-label={c.allDestinations} className="ds-only-large flex-col border-b border-foreground/10 px-2 py-2">
            {tabs.map((x) => (
              <li key={x.key}>
                <a href={`#${x.key}`} aria-current={x.active ? "page" : undefined} className={clsx("flex min-h-12 items-center gap-3 rounded-xl px-3 text-[1rem]", x.active ? "font-bold text-primary" : "font-medium", FOCUS_RING)}>
                  <x.icon className="ds-icon" aria-hidden />
                  <span>{x.label}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
        {/* Regular text: five tabs. */}
        <div className="ds-hide-large flex">{tabs.map(tab)}</div>
        {/* Large text: Home + current + More (every destination stays reachable, labels in full). */}
        <div className="ds-only-large">
          {compact.map(tab)}
          <button
            type="button"
            data-ds-nav-more=""
            aria-expanded={moreOpen}
            aria-controls={sheetId}
            onClick={() => setMoreOpen((o) => !o)}
            className={clsx("flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-1.5 text-center text-[0.8125rem] font-medium leading-[1.45] text-foreground/70", FOCUS_RING)}
          >
            <span className="flex w-full max-w-[3.5rem] items-center justify-center rounded-full py-1">{moreOpen ? <X className="ds-icon" aria-hidden /> : <Menu className="ds-icon" aria-hidden />}</span>
            <span data-ds-nav-label="" className="block max-w-full">
              {c.more}
            </span>
          </button>
        </div>
      </nav>
    </div>
  );
}
