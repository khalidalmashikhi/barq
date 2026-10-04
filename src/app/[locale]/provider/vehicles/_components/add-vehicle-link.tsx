"use client";

import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { clearOnboardingRequestKey, safeSessionStorage } from "@/lib/vehicles/onboarding/onboarding-request-key-store";

// Phase 3C Slice 3B — the explicit "Add vehicle" entry point. Choosing it means "a NEW vehicle":
// the browser's copy of any earlier, unresolved onboarding request key is dropped first, so the
// upload step issues a fresh key. (Simply returning to the upload step — reload, back/forward —
// keeps the old key and resumes that attempt instead.) The server's record of the earlier request
// is untouched; an unfinished setup it created stays in the list, resumable and cancellable.

export function AddVehicleLink({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Link href="/provider/vehicles/new" className={className} onClick={() => clearOnboardingRequestKey(safeSessionStorage())}>
      {children}
    </Link>
  );
}
