"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { User, Store } from "lucide-react";
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
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => choose("CUSTOMER")}
        aria-busy={pending && choosing === "CUSTOMER"}
        className="flex items-start gap-3 rounded-2xl border border-border p-4 text-start transition-colors hover:border-primary hover:bg-accent/10 disabled:opacity-50"
      >
        <User size={22} strokeWidth={1.75} className="mt-0.5 shrink-0 text-primary" />
        <span className="flex flex-col gap-0.5">
          <span className="text-base font-semibold text-foreground">{labels.customerTitle}</span>
          <span className="text-sm text-foreground/60">{labels.customerDescription}</span>
        </span>
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => choose("PROVIDER")}
        aria-busy={pending && choosing === "PROVIDER"}
        className="flex items-start gap-3 rounded-2xl border border-border p-4 text-start transition-colors hover:border-primary hover:bg-accent/10 disabled:opacity-50"
      >
        <Store size={22} strokeWidth={1.75} className="mt-0.5 shrink-0 text-primary" />
        <span className="flex flex-col gap-0.5">
          <span className="text-base font-semibold text-foreground">{labels.providerTitle}</span>
          <span className="text-sm text-foreground/60">{labels.providerDescription}</span>
        </span>
      </button>
    </div>
  );
}
