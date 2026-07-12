import Link from "next/link";
import { PackageOpen } from "lucide-react";
import { t } from "@/lib/i18n/strings";

// Branded not-found for /provider/services/[id] — Provider Dashboard
// Phase 2, mirroring src/app/services/[id]/not-found.tsx's existing
// convention. Distinct from src/app/provider/layout.tsx's own
// notFound() (which hides whether the Provider Dashboard exists at
// all, for a non-Provider visitor): this one renders for a legitimate,
// authenticated Provider viewing a service id that either doesn't
// exist or belongs to another Provider — getProviderServiceDetail()
// returns null identically for both, so this page never reveals which
// case it was. Because Next.js renders a route segment's own
// not-found.tsx inside its parent layouts, this still displays inside
// the real AppShell (sidebar/topbar intact) — unlike the layout's own
// notFound(), which correctly escapes the whole shell.

export default function ProviderServiceNotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-8 py-20 text-center">
      <PackageOpen size={32} strokeWidth={1.5} className="text-foreground/25" />
      <p className="text-foreground/60">{t.providerServiceNotFoundMessage}</p>
      <Link
        href="/provider/services"
        className="mt-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        {t.providerBackToServicesLabel}
      </Link>
    </div>
  );
}
