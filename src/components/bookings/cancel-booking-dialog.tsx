"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { XCircle } from "lucide-react";

// Cancel Booking confirmation dialog — Customer Experience Platform.
//
// NO NEW MUTATION, NO NEW ELIGIBILITY, NO REASON FIELD: `action` is the
// exact same server action the booking detail page already builds
// around cancelBooking() (cancel-booking.ts itself is untouched) — this
// component only adds a client-side confirmation step in front of it.
// No reason/comment field exists here because neither the schema nor
// cancelBooking() accepts one.
//
// ACCESSIBILITY, mirroring this codebase's own existing dialog pattern
// (AppMobileNav's role="dialog"/focus-restore/Escape-to-close — the
// only prior "modal-shaped" UI in this repo; there was no separate
// generic Modal component to reuse, so this follows that established
// pattern rather than inventing a new one):
//  - role="dialog" aria-modal="true" aria-labelledby
//  - focus moves to the dialog's Confirm button on open, restores to
//    the trigger button on close (including Escape and outside click)
//  - Escape closes; a backdrop click closes
//  - useTransition's isPending disables both buttons and shows a
//    pending label, preventing a double submission
//  - RTL-safe: only logical Tailwind utilities (ms-*, text-start, etc.)
//    are used, no left/right-specific classes

type CancelBookingDialogProps = {
  action: () => Promise<void>;
  serviceName: string;
  triggerLabel: string;
  titleLabel: string;
  bodyLabel: string;
  cancelLabel: string;
  confirmLabel: string;
  pendingLabel: string;
};

export function CancelBookingDialog({
  action,
  serviceName,
  triggerLabel,
  titleLabel,
  bodyLabel,
  cancelLabel,
  confirmLabel,
  pendingLabel,
}: CancelBookingDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const triggerButton = triggerRef.current;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isPending) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      triggerButton?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleConfirm() {
    startTransition(async () => {
      await action();
    });
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-full border border-danger/40 px-6 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10"
      >
        {triggerLabel}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !isPending && setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-booking-dialog-title"
            aria-describedby="cancel-booking-dialog-body"
            onClick={(event) => event.stopPropagation()}
            className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-premium-lg"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger">
                <XCircle size={18} strokeWidth={1.75} aria-hidden />
              </span>
              <div>
                <h2 id="cancel-booking-dialog-title" className="text-base font-semibold text-foreground">
                  {titleLabel}
                </h2>
                <p className="mt-1 text-sm font-medium text-foreground/70">{serviceName}</p>
              </div>
            </div>

            <p id="cancel-booking-dialog-body" className="text-sm text-foreground/60">
              {bodyLabel}
            </p>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={isPending}
                className="rounded-full px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cancelLabel}
              </button>
              <button
                ref={confirmRef}
                type="button"
                onClick={handleConfirm}
                disabled={isPending}
                className="rounded-full bg-danger px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPending ? pendingLabel : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
