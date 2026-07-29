import { Link } from "@/i18n/navigation";
import { CalendarX } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Branded not-found for /provider/bookings/[id] — Provider Operations
// Foundation, mirroring provider/services/[id]/not-found.tsx's existing
// convention. getProviderBookingDetail() returns null identically for a
// missing booking and a booking belonging to another provider, so this
// page never reveals which case it was.

export default async function ProviderBookingNotFound() {
  const t = await getServerTranslator("provider");

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-8 py-20 text-center">
      <CalendarX size={32} strokeWidth={1.5} className="text-foreground/25" />
      <p className="text-foreground/60">{t("bookingNotFoundMessage")}</p>
      <Link
        href="/provider/bookings"
        className="mt-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        {t("backToBookingsLabel")}
      </Link>
    </div>
  );
}
