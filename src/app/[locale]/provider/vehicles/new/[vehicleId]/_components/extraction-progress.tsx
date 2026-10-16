"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Alert } from "@/components/ui/alert";
import { ReadingStatusPanel } from "@/components/provider/vehicle-journey/reading-status-panel";
import { JOURNEY_CARD, JOURNEY_SECONDARY } from "@/components/provider/vehicle-journey/journey-ui";

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

export function ExtractionProgress({ summary = null }: { summary?: string | null }) {
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
      <div role="status" aria-live="polite" className={`${JOURNEY_CARD} flex flex-col gap-4`}>
        <Alert variant="warning">{t("vehicleOnboardReadingSlow")}</Alert>
        <button type="button" onClick={() => router.refresh()} className={`${JOURNEY_SECONDARY} self-start`}>
          <RefreshCw size={18} strokeWidth={1.75} aria-hidden />
          {t("vehicleOnboardReadingRefresh")}
        </button>
      </div>
    );
  }

  return (
    <section className={JOURNEY_CARD}>
      <ReadingStatusPanel summary={summary} />
    </section>
  );
}
