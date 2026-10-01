"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { ScanLine } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { analyzeRegistrationAction } from "../registration-actions";
import { registrationReviewMessageKey, type RegistrationReviewCode } from "@/lib/vehicles/registration-review/registration-review-result";

// Phase 3C Slice 3A — starts a SEPARATE authenticated extraction request on the already-uploaded
// document, with a visible progress state. Idempotent/concurrency-safe via the Slice-2 service;
// duplicate clicks are prevented while pending. On success it refreshes to show the new state.
export function AnalyzeRegistrationButton({ vehicleId, retry }: { vehicleId: string; retry: boolean }) {
  const t = useTranslations("provider");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<RegistrationReviewCode | null>(null);

  const run = () => {
    setErrorCode(null);
    startTransition(async () => {
      const res = await analyzeRegistrationAction(vehicleId);
      if (res.ok) {
        router.refresh();
        return;
      }
      setErrorCode(res.code);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <ScanLine size={15} strokeWidth={1.75} aria-hidden />
        {pending ? t("vehicleRegAnalyzing") : retry ? t("vehicleRegRetryButton") : t("vehicleRegAnalyzeButton")}
      </button>
      {errorCode && <Alert variant="danger">{t(registrationReviewMessageKey(errorCode))}</Alert>}
    </div>
  );
}
