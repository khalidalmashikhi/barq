"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Alert } from "@/components/ui/alert";

// Phase 3C (registration OCR) — shown while the registration document is being read (another
// request holds the extraction lease, typically an OCR call in flight). It only WAITS: it re-renders
// the server page on a short interval until the server reports a final state. It never starts a
// second reading and sends nothing to the server besides the page refresh. The wait is bounded —
// the server stops reporting "reading" once the lease expires, and this stops asking after a while.
//
// 2026-10-16: the same spinner + "Reading vehicle details…" + "keep this page open" as the consent
// button (no fabricated percentage). When the bounded wait ends without a final state, it says so
// honestly and offers a refresh — the refreshed page then shows the result, or the retry and the
// manual path — instead of an endless "reading" screen.

const INTERVAL_MS = 3000;
const MAX_REFRESHES = 40; // ~2 minutes, longer than the server-side lease

export function ExtractionProgress() {
  const t = useTranslations("provider");
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      router.refresh();
      if (count >= MAX_REFRESHES) {
        clearInterval(timer);
        setGaveUp(true);
      }
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, [router]);

  if (gaveUp) {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-3">
        <Alert variant="warning">{t("vehicleOnboardReadingSlow")}</Alert>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="inline-flex min-h-12 items-center justify-center gap-2 self-start rounded-full border border-border px-5 text-base font-semibold text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <RefreshCw size={18} strokeWidth={1.75} aria-hidden />
          {t("vehicleOnboardReadingRefresh")}
        </button>
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite" className="flex items-start gap-3 rounded-2xl border border-border bg-accent/10 p-4">
      <Loader2 size={22} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold text-foreground">{t("vehicleRegConsentReadingPending")}</p>
        <p className="text-sm text-foreground/80">{t("vehicleRegConsentReadingHint")}</p>
      </div>
    </div>
  );
}
