"use client";

import { useEffect, useRef, type ReactNode } from "react";

// 2026-10-15 — the ONE bottom action bar of the provider vehicle forms (registration upload, onboarding
// review, vehicle-detail confirmation).
//
// LAYOUT CONTRACT (see globals.css "Provider vehicle action bars"):
//   • the DOCUMENT is the single vertical scroll owner (as on every AppShell page — the shell's
//     `<main>` is never height-constrained, so it never scrolls);
//   • a page that renders this bar marks itself with `data-provider-action-bar`; for that page only the
//     shell's `<main>` drops its inert `overflow-y-auto` (which made it the sticky containing box and
//     kept the bar from ever sticking) and clips horizontally instead — no other AppShell consumer is
//     affected;
//   • below `sm` the bar is `sticky bottom-0` against the viewport, in normal flow (it never covers the
//     last field: it occupies its own space at the end of the form); from `sm` up it is static;
//   • its measured height is published as `--provider-action-bar-height` so the document's
//     scroll-padding keeps a focused / scrolled-to field above the bar (no hard-coded offset).

export const ACTION_BAR_HEIGHT_PROPERTY = "--provider-action-bar-height";

export function StickyActionBar({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const write = () => root.style.setProperty(ACTION_BAR_HEIGHT_PROPERTY, `${Math.ceil(el.getBoundingClientRect().height)}px`);
    write();
    if (typeof ResizeObserver === "undefined") return () => root.style.removeProperty(ACTION_BAR_HEIGHT_PROPERTY);
    const observer = new ResizeObserver(write);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty(ACTION_BAR_HEIGHT_PROPERTY);
    };
  }, []);

  return (
    <div ref={ref} data-provider-action-bar="" className={`sticky bottom-0 sm:static ${className}`}>
      {children}
    </div>
  );
}
