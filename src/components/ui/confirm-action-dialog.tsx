"use client";

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Dialog } from "./dialog";

// Confirmation gate for a high-impact/destructive Admin action (Admin action UX polish, §6).
// A labelled trigger (icon + text, never icon-only for these actions) opens an accessible
// Dialog stating in plain language what will happen and who is affected; the action fires
// ONLY on an explicit Confirm. The underlying mutation is the SAME server action as before —
// passed in as `action` and submitted by the dialog's form — so this changes nothing about
// authorization or business rules (server-side requireOwner/requirePermission stay
// authoritative). Cancel closes without mutating. The confirm button is pending-aware
// (disabled + spinner) to prevent a double-submit. `confirmVariant` sets the visual
// hierarchy: "danger" (destructive) or "primary" (impactful but non-destructive).

const TRIGGER_VARIANT = {
  danger:
    "rounded-full border border-danger/30 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 disabled:opacity-50",
  secondary:
    "rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50",
} as const;

export function ConfirmActionDialog({
  action,
  triggerLabel,
  triggerIcon,
  triggerVariant = "danger",
  title,
  description,
  confirmLabel,
  cancelLabel,
  confirmVariant = "danger",
}: {
  action: () => void | Promise<void>;
  triggerLabel: string;
  triggerIcon?: ReactNode;
  triggerVariant?: keyof typeof TRIGGER_VARIANT;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmVariant?: "danger" | "primary";
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 ${TRIGGER_VARIANT[triggerVariant]}`}
      >
        {triggerIcon}
        {triggerLabel}
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title={title} description={description}>
        <form action={action} className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            {cancelLabel}
          </button>
          <ConfirmButton label={confirmLabel} variant={confirmVariant} />
        </form>
      </Dialog>
    </>
  );
}

// Must be its own component so useFormStatus() reads the enclosing <form>'s pending state
// (same rule as SubmitButton). Disables + shows a spinner during the mutation → no double-submit.
function ConfirmButton({ label, variant }: { label: string; variant: "danger" | "primary" }) {
  const { pending } = useFormStatus();
  const cls =
    variant === "danger"
      ? "bg-danger text-white hover:opacity-90 focus-visible:ring-danger/40"
      : "bg-primary text-primary-foreground hover:opacity-90 focus-visible:ring-primary/40";
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full px-5 py-2 text-sm font-medium transition-opacity focus-visible:outline-none focus-visible:ring-2 disabled:opacity-60 ${cls}`}
    >
      {pending && <Loader2 size={15} strokeWidth={2} className="animate-spin" aria-hidden />}
      {label}
    </button>
  );
}
