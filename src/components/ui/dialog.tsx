"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

// Accessible modal Dialog primitive (Admin action UX polish). No UI framework — a small,
// self-contained overlay used by ConfirmActionDialog. Behaviour: role="dialog" +
// aria-modal, labelled by its title and (optionally) described by its body; focus moves
// into the panel on open and is TRAPPED (Tab/Shift+Tab cycle within it); Escape or a
// backdrop click closes it; focus returns to the previously-focused element on close; body
// scroll is locked while open. Responsive: a bottom-sheet on phones (items-end,
// rounded-top) and a centered card from `sm` up. Danger is never conveyed by colour alone —
// the callers pair colour with an explicit label and icon.
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = (document.activeElement as HTMLElement | null) ?? null;
    const panel = panelRef.current;

    const selector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () => Array.from(panel?.querySelectorAll<HTMLElement>(selector) ?? []);
    (focusables()[0] ?? panel)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const f = focusables();
        if (f.length === 0) {
          e.preventDefault();
          return;
        }
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className="relative z-10 w-full max-w-md rounded-t-2xl border border-border bg-card p-6 shadow-premium-lg outline-none sm:rounded-2xl"
      >
        <h2 id={titleId} className="text-lg font-semibold text-foreground">
          {title}
        </h2>
        {description && (
          <p id={descId} className="mt-2 text-sm leading-relaxed text-foreground/60">
            {description}
          </p>
        )}
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}
