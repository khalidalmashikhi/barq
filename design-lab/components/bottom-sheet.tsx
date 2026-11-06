import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { FOCUS_RING } from "../tokens";

// Proposed BottomSheet (phone menus such as the large-text "More" navigation). Same behaviour as the
// app's ui/dialog.tsx (role="dialog" + aria-modal, focus moves in and is TRAPPED, Escape or a tap on
// the dimmed backdrop closes, body scroll locked, focus returns on close) plus:
//   • at most 70 % of the screen (70dvh, 70vh fallback — design-lab/lab.css `.ds-sheet`), the list
//     scrolls inside the sheet;
//   • a visible close button (icon + word);
//   • bottom padding honours the home indicator (env(safe-area-inset-bottom); --ds-test-safe-bottom
//     emulates it in Chromium tests);
//   • rendered in a portal on <body>: an ancestor with backdrop-filter (the bottom nav) would otherwise
//     become the containing block of the fixed layer;
//   • focus returns to `returnFocusRef` (the opener) — a tap does not focus a button on iOS, so the
//     previously focused element is not reliable there.

export function BottomSheet({
  open,
  onClose,
  title,
  closeLabel,
  returnFocusRef,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  closeLabel: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // the latest onClose without re-running the open effect (which would move focus again)
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const returnTo = returnFocusRef?.current ?? (document.activeElement as HTMLElement | null);
    const panel = panelRef.current;
    const selector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () => Array.from(panel?.querySelectorAll<HTMLElement>(selector) ?? []);
    (focusables()[0] ?? panel)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
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
        const inside = panel?.contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === first || !inside)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
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
      returnTo?.focus?.();
    };
  }, [open, returnFocusRef]);

  if (!open) return null;

  return createPortal(
    <div data-ds-sheet-layer="" role="presentation" className="fixed inset-0 z-50 flex flex-col justify-end">
      <div data-ds-sheet-backdrop="" aria-hidden className="absolute inset-0 bg-black/45" onClick={() => close.current()} />
      <div
        ref={panelRef}
        data-ds-sheet=""
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="ds-sheet relative flex w-full flex-col rounded-t-[1.5rem] bg-card text-foreground shadow-[0_-8px_30px_rgba(15,23,42,0.18)] outline-none"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-foreground/10 py-2 pe-2 ps-5">
          {/* never narrower than its longest word: the close button wraps under the title instead */}
          <h2 id={titleId} className="flex-1 text-[1.0625rem] font-semibold leading-[1.5]">
            {title}
          </h2>
          <button type="button" data-ds-sheet-close="" onClick={() => close.current()} className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-[1rem] font-medium text-primary hover:bg-[#EEF4F8] ${FOCUS_RING}`}>
            <X className="ds-icon" aria-hidden />
            {closeLabel}
          </button>
        </div>
        <div data-ds-sheet-body="" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pt-2 pb-[max(env(safe-area-inset-bottom),var(--ds-test-safe-bottom,0px),0.75rem)] scroll-pb-[max(env(safe-area-inset-bottom),var(--ds-test-safe-bottom,0px),0.75rem)]">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
