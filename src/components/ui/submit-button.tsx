"use client";

import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes } from "react";

// Submit button for a Server Action form — Phase C.3 Group 1 (Booking
// Flow hardening). Disables itself for the duration of the pending
// submission, preventing an ordinary double-click (or a second click
// during a slow response) from firing the action twice — UI-layer
// defense in depth alongside the server-side duplicate-booking check
// in src/lib/booking/create-booking.ts, not a replacement for it.
//
// Must be its own Client Component: useFormStatus() only reads the
// status of the nearest ANCESTOR <form>, so it has to run one
// component below the form itself — it cannot be inlined into the
// (Server Component) page that renders the form.

// `pendingLabel` (optional) — a localized label shown WHILE the server action is pending, in place
// of the idle children (e.g. "Booking…"). UX only; correctness is the server's idempotency +
// duplicate guards, never this. Omitting it preserves the exact prior behavior for every existing
// caller (the idle children stay visible during the pending state).
type SubmitButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { pendingLabel?: string };

export function SubmitButton({ disabled, children, pendingLabel, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={disabled || pending} aria-busy={pending || undefined} {...props}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
