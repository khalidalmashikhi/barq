"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";

// Offline banner — Phase F.4 (goal 8, Error Experience). No service
// worker or PWA infrastructure exists in this app (confirmed by grep
// before writing this), so a dedicated offline *page* would be
// fabricated — the browser can't even reach this app to render one
// once truly offline. What IS real and buildable without any backend:
// the browser's native online/offline events and navigator.onLine,
// surfaced as a small persistent banner so a dropped connection is
// visible instead of silently failing fetches. Mounted once at the
// root layout, so it covers every route, authenticated or not.

export function OfflineBanner() {
  const t = useTranslations("common");
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    setIsOffline(!navigator.onLine);

    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => setIsOffline(false);

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-danger px-4 py-2 text-center text-sm font-medium text-white"
    >
      <WifiOff size={15} strokeWidth={2} aria-hidden />
      {t("offlineNotice")}
    </div>
  );
}
