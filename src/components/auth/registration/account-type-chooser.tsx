"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { CalendarCheck, BriefcaseBusiness, Loader2, type LucideIcon } from "lucide-react";
import { setAccountType } from "@/lib/registration/set-account-type";
import { isRegistrationErrorCode, getRegistrationErrorTranslationKey } from "@/lib/registration/registration-errors";

// EXCLUSIVE PHONE-FIRST REGISTRATION — Gate Z-2. The choose-usage screen. Two mutually
// exclusive options; the selection is written server-side (setAccountType, which
// validates and locks after finalization). Human copy only — no role/enum words. The
// server re-derives the next step, so on success we just refresh.
type Labels = {
  customerTitle: string;
  customerDescription: string;
  providerTitle: string;
  providerDescription: string;
  genericError: string;
};

export function AccountTypeChooser({ labels, errorLabels }: { labels: Labels; errorLabels: Record<string, string> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<"CUSTOMER" | "PROVIDER" | null>(null);

  function choose(type: "CUSTOMER" | "PROVIDER") {
    setError(null);
    setChoosing(type);
    startTransition(async () => {
      const result = await setAccountType(type);
      if (result.ok) {
        router.refresh();
        return;
      }
      setChoosing(null);
      setError(isRegistrationErrorCode(result.error) ? errorLabels[getRegistrationErrorTranslationKey(result.error)] ?? labels.genericError : labels.genericError);
    });
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      {error && (
        <p role="alert" className="text-sm text-danger sm:order-first sm:w-full sm:basis-full">
          {error}
        </p>
      )}
      <ChooserCard
        icon={CalendarCheck}
        title={labels.customerTitle}
        description={labels.customerDescription}
        busy={pending && choosing === "CUSTOMER"}
        disabled={pending}
        onClick={() => choose("CUSTOMER")}
      />
      <ChooserCard
        icon={BriefcaseBusiness}
        title={labels.providerTitle}
        description={labels.providerDescription}
        busy={pending && choosing === "PROVIDER"}
        disabled={pending}
        onClick={() => choose("PROVIDER")}
      />
    </div>
  );
}

// A single account-type card. Distinct, LARGE icon in a tinted rounded container; full
// default / hover / focus-visible / pressed states; and a busy indicator (spinner→check)
// that never relies on colour alone. Vertical layout stacks the icon above the copy so the
// glyph is the first thing read, and the two cards sit side-by-side from `sm` up (stacked on
// narrow phones for comfortable touch targets). RTL is handled by logical properties
// (text-start); no LTR-only spacing.
function ChooserCard({
  icon: Icon,
  title,
  description,
  busy,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-busy={busy}
      className={[
        "group relative flex flex-1 flex-col items-start gap-3 rounded-2xl border p-5 text-start",
        "transition-[color,background-color,border-color,box-shadow,transform] duration-150",
        "hover:border-primary hover:bg-primary/5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "active:scale-[0.99] disabled:opacity-60 disabled:active:scale-100",
        busy ? "border-primary bg-primary/5 shadow-premium" : "border-border",
      ].join(" ")}
    >
      <span
        className={[
          "flex h-12 w-12 items-center justify-center rounded-xl transition-colors",
          busy ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary group-hover:bg-primary/15",
        ].join(" ")}
      >
        <Icon size={26} strokeWidth={1.75} />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-base font-semibold text-foreground">{title}</span>
        <span className="text-sm leading-relaxed text-foreground/60">{description}</span>
      </span>
      {/* Non-colour-only busy/selected indicator: a spinner while the selection is being
          applied, plus the filled icon container above. Sits at the end (RTL-safe via end-4). */}
      {busy && (
        <span className="absolute end-4 top-4 text-primary" aria-hidden>
          <Loader2 size={18} strokeWidth={2} className="animate-spin" />
        </span>
      )}
    </button>
  );
}
