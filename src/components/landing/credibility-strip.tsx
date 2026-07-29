import { BadgeCheck, History, ReceiptText, KeyRound } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Credibility Strip — Phase 3 Wave 2, landing page, below Trust Bar.
//
// The brief's own example items ("Licensed", "Fast Support", "Secure
// Payments") were checked against what this app actually does before
// implementing, per this project's standing "never fabricate" rule:
// - "Licensed": docs/01-business/BUSINESS_MODEL.md lists Ministry of
//   Heritage & Tourism licensing as an ACKNOWLEDGED, UNRESOLVED risk,
//   not a granted license — claiming it would misrepresent a flagged
//   risk as an achieved credential.
// - "Fast Support": contact/page.tsx's own copy states plainly that
//   "direct contact isn't connected yet" — no live support channel
//   exists to make this claim true.
// - "Secure Payments": services.json's own FAQ answer states payment
//   details are "handled separately from the booking request itself"
//   — there is no integrated payment-processing system to secure.
//
// Replaced with four claims that are true today and already
// established elsewhere in this app: verified providers (Provider
// .status === APPROVED, same gate ProvidersSection/ProviderProfileCard
// use), tracked bookings (the real BookingStatusEvent audit trail),
// transparent pricing (WhyChooseSection's existing real claim), and
// secure sign-in (phone-OTP auth, no passwords — genuinely how
// authentication works in this app).

const items = [
  { key: "verified", icon: BadgeCheck },
  { key: "tracked", icon: History },
  { key: "transparent", icon: ReceiptText },
  { key: "secureSignIn", icon: KeyRound },
] as const;

export async function CredibilityStrip() {
  const t = await getServerTranslator("landing");

  return (
    <section className="px-6 py-5">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3">
        {items.map(({ key, icon: Icon }) => (
          <div key={key} className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-foreground/50">
            <Icon size={14} strokeWidth={1.75} className="shrink-0" aria-hidden />
            {t(`credibility.${key}`)}
          </div>
        ))}
      </div>
    </section>
  );
}
