"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Dialog } from "@/components/ui/dialog";
import { registerLocaleSwitchInterceptor } from "@/components/layout/locale-switch-guard";

// 2026-10-12 — unsaved PRIVATE registration values are never written to browser storage, so a
// language switch (which remounts the form) would lose them. While such values exist the form holds
// the switch and asks: stay on this language, or save progress through the form's EXISTING save
// action and then switch. Nothing is discarded silently and nothing private is persisted to survive
// the switch. Both registration forms use this one hook + dialog.

export function useUnsavedLanguageGuard(active: boolean) {
  const router = useRouter(); // plain Next router: the target is already a complete locale path
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    return registerLocaleSwitchInterceptor((href) => {
      setTarget(href);
      return true;
    });
  }, [active]);

  return {
    /** The language path the provider asked for while private changes were unsaved (dialog open). */
    target,
    stay: () => setTarget(null),
    /** After the existing save succeeded: continue to the requested language. */
    continueToTarget: () => {
      const href = target;
      setTarget(null);
      if (href) router.push(href);
    },
  };
}

const BUTTON = "inline-flex min-h-11 w-full items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50 sm:w-auto";

export function UnsavedLanguageDialog({ open, pending, onStay, onSaveAndSwitch }: { open: boolean; pending: boolean; onStay: () => void; onSaveAndSwitch: () => void }) {
  const t = useTranslations("provider");
  return (
    <Dialog open={open} onClose={onStay} title={t("vehicleRegLocaleGuardTitle")} description={t("vehicleRegLocaleGuardMessage")}>
      <div className="flex flex-col-reverse gap-2 pb-[env(safe-area-inset-bottom)] sm:flex-row sm:justify-end">
        <button type="button" onClick={onStay} disabled={pending} className={`${BUTTON} border border-border bg-background text-foreground`}>
          {t("vehicleRegLocaleGuardStay")}
        </button>
        <button type="button" onClick={onSaveAndSwitch} disabled={pending} className={`${BUTTON} bg-primary text-primary-foreground`}>
          {pending ? t("vehicleRegSaving") : t("vehicleRegLocaleGuardSave")}
        </button>
      </div>
    </Dialog>
  );
}
