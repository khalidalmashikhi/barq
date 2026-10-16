"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

// 2026-10-16 (correction) — client-only bridge between the consent step and the journey header on
// the "read details" page: when an automatic-reading attempt fails INSIDE the step (before the page
// is replaced), the header shows step 2 as current + error instead of a calm "in progress". Pure
// presentation state: nothing here starts a request, stores anything or reaches the server. Without
// a provider (every other screen) the hook returns null and the callers do nothing.

type JourneyStatus = { readingFailed: boolean; setReadingFailed: (failed: boolean) => void };

const JourneyStatusContext = createContext<JourneyStatus | null>(null);

export function JourneyStatusProvider({ children }: { children: ReactNode }) {
  const [readingFailed, setReadingFailed] = useState(false);
  const value = useMemo(() => ({ readingFailed, setReadingFailed }), [readingFailed]);
  return <JourneyStatusContext.Provider value={value}>{children}</JourneyStatusContext.Provider>;
}

export function useJourneyStatus(): JourneyStatus | null {
  return useContext(JourneyStatusContext);
}
