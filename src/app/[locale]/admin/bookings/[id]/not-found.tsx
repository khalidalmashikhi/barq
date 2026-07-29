import { Link } from "@/i18n/navigation";
import { CalendarX } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Branded not-found for /admin/bookings/[id] — Phase 2.10 (Booking
// Admin UI). Mirrors admin/availability/[id]/not-found.tsx's convention.

export default async function BookingNotFound() {
  const t = await getServerTranslator("admin");

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-8 py-20 text-center">
      <CalendarX size={32} strokeWidth={1.5} className="text-foreground/25" />
      <p className="text-foreground/60">{t("bookingNotFoundMessage")}</p>
      <Link
        href="/admin/bookings"
        className="mt-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        {t("backToBookingsLabel")}
      </Link>
    </div>
  );
}
