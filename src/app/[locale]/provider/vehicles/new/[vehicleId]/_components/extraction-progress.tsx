"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Alert } from "@/components/ui/alert";

// Phase 3C (registration OCR) — shown while the registration document is being read (another
// request holds the extraction lease, typically an OCR call in flight). It only WAITS: it re-renders
// the server page on a short interval until the server reports a final state. It never starts a
// second reading and sends nothing to the server besides the page refresh. The wait is bounded —
// the server stops reporting "reading" once the lease expires, and this stops asking after a while.

const INTERVAL_MS = 3000;
const MAX_REFRESHES = 40; // ~2 minutes, longer than the server-side lease

export function ExtractionProgress() {
  const t = useTranslations("provider");
  const router = useRouter();

  useEffect(() => {
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      router.refresh();
      if (count >= MAX_REFRESHES) clearInterval(timer);
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <div role="status" aria-live="polite">
      <Alert variant="info">{t("vehicleOnboardReadingNotice")}</Alert>
    </div>
  );
}
