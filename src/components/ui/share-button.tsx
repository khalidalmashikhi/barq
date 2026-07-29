"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { clsx } from "./clsx";
import { shareOrCopy, type ShareOrCopyResult } from "@/lib/sharing/share-or-copy";

// Share button — Growth Foundations phase.
//
// GENERIC SHARING ONLY, PER EXPLICIT SCOPE: navigator.share() first
// (lets the OS's own share sheet offer whatever the device already has
// installed — Messages, WhatsApp, Mail, etc.), falling back to a
// clipboard copy of the same URL when the Web Share API is unavailable
// (most desktop browsers) or the user's browser blocks it. No
// social-network-specific SDK, no deep link to any one platform. The
// actual decision logic lives in the framework-independent
// shareOrCopy() (src/lib/sharing/share-or-copy.ts) so it can be unit-
// tested without a DOM — this component is a thin wrapper that injects
// the real navigator.share/navigator.clipboard.
//
// ACCESSIBLE FEEDBACK: the status text after a click is rendered inside
// an `aria-live="polite"` region so screen-reader users hear "Link
// copied" / the error text without needing to re-focus anything; the
// button itself remains a plain, always-enabled, keyboard-reachable
// <button type="button"> throughout (never disabled while idle).

export type ShareButtonProps = {
  url: string;
  title: string;
  text?: string;
  label: string;
  copiedLabel: string;
  errorLabel: string;
  icon?: ReactNode;
  /**
   * Full className for the <button> itself — no visual style is baked
   * in (mirrors SubmitButton's own no-default-styling contract), since
   * this button is dropped into visually different contexts across the
   * app (a pill next to a price card on Service/Provider Detail, a
   * dashed icon-stack tile alongside Download/Contact on the booking
   * confirmation page) rather than owning one fixed look.
   */
  className: string;
  /** Wrapper className, for the caller's own layout (e.g. a 3-column grid cell). Defaults to a plain inline-flex column. */
  wrapperClassName?: string;
};

export function ShareButton({ url, title, text, label, copiedLabel, errorLabel, icon, className, wrapperClassName }: ShareButtonProps) {
  const [result, setResult] = useState<ShareOrCopyResult | null>(null);

  async function handleClick() {
    const outcome = await shareOrCopy({
      url,
      title,
      text,
      hasShare: typeof navigator !== "undefined" && typeof navigator.share === "function",
      share: (data) => navigator.share(data),
      clipboardWrite: (value) => navigator.clipboard.writeText(value),
    });
    setResult(outcome);
  }

  const feedback = result === "copied" ? copiedLabel : result === "error" ? errorLabel : "";

  return (
    <div className={clsx("inline-flex flex-col items-center gap-1", wrapperClassName)}>
      <button type="button" onClick={handleClick} className={className}>
        {icon}
        {label}
      </button>
      <span role="status" aria-live="polite" className="min-h-[1em] text-xs text-foreground/50">
        {feedback}
      </span>
    </div>
  );
}
