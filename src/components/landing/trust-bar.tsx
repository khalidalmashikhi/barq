import { Users, BadgeCheck, ShieldCheck, Globe } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Trust Bar — Phase 3 Wave 2, landing page, directly below the Hero.
// Every claim maps to something real and already shipped elsewhere in
// this app, not marketing invention: "Trusted Local Providers" and
// "Verified Experiences" reflect Provider.status === APPROVED (the
// same gate ProvidersSection/ProviderProfileCard already show);
// "Secure Booking" mirrors BookingTrustPanel's real tracked-lifecycle
// claim; "Multilingual Support" is the app's real 8-locale coverage
// (ar/en/de/fr/it/pl/cs/ru), not an aspirational claim.

const items = [
  { key: "providers", icon: Users },
  { key: "verified", icon: BadgeCheck },
  { key: "booking", icon: ShieldCheck },
  { key: "multilingual", icon: Globe },
] as const;

export async function TrustBar() {
  const t = await getServerTranslator("landing");

  return (
    <section className="border-y border-border bg-card px-6 py-6">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-4 sm:justify-between">
        {items.map(({ key, icon: Icon }) => (
          <div key={key} className="flex items-center gap-2.5 text-sm text-foreground/70">
            <Icon size={18} strokeWidth={1.75} className="shrink-0 text-primary" aria-hidden />
            <span className="font-medium">{t(`trustBar.${key}`)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
