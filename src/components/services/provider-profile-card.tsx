import { BadgeCheck, MessageCircle, Package } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { Badge } from "@/components/ui/badge";

// Provider profile card — Phase F.2 (goal 8). Real fields only:
// businessName/businessDescription (Provider model), a status-derived
// "Verified" badge (ProviderStatus.APPROVED — the platform's real
// approval gate, not a fabricated separate flag), and a real published
// -services count (getProviderPublishedServicesCount). No logo/cover
// image — no such field exists on Provider — an initial-letter avatar
// is used instead of a fake photo, matching this project's established
// "honest, not fabricated" convention. "Contact Provider" has no
// backing messaging system, so it renders as an honestly disabled
// action (aria-disabled, muted), the same pattern AppSidebar already
// uses for Settings/Saved — not a dead-end button dressed up as real.
//
// Marketplace Completion — providerId powers a new "View provider
// profile" link to the public provider storefront
// (/providers/[idOrSlug]), closing the previously-confirmed gap where
// no page let a customer browse all of one provider's experiences
// together. Links by id (always resolvable, per
// getProviderProfile()'s own id-or-slug lookup) rather than assuming a
// slug is set.

type ProviderProfileCardProps = {
  providerId: string;
  providerName: string;
  providerDescription: string;
  providerStatus: string;
  publishedServicesCount: number;
};

export async function ProviderProfileCard({
  providerId,
  providerName,
  providerDescription,
  providerStatus,
  publishedServicesCount,
}: ProviderProfileCardProps) {
  const t = await getServerTranslator("services");
  const isVerified = providerStatus === "APPROVED";
  const initial = providerName.trim().charAt(0) || "?";

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-secondary text-lg font-semibold text-white">
          {initial}
        </span>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-foreground">{providerName}</span>
            {isVerified && (
              <Badge variant="info" className="gap-1">
                <BadgeCheck size={13} strokeWidth={2} />
                {t("verifiedProviderLabel")}
              </Badge>
            )}
          </div>
          <span className="flex items-center gap-1.5 text-xs text-foreground/50">
            <Package size={13} strokeWidth={1.75} />
            {t("experiencesCountLabel", { count: publishedServicesCount })}
          </span>
        </div>
      </div>

      {providerDescription && <p className="mt-4 text-sm leading-relaxed text-foreground/70">{providerDescription}</p>}

      <Link
        href={`/providers/${providerId}`}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm font-medium text-foreground/70 transition-colors hover:border-primary/40 hover:text-primary"
      >
        {t("viewProviderProfileLabel")}
      </Link>

      <button
        type="button"
        disabled
        aria-disabled
        className="mt-4 flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm font-medium text-foreground/35"
      >
        <MessageCircle size={15} strokeWidth={1.75} />
        {t("contactProviderLabel")}
      </button>
    </div>
  );
}
