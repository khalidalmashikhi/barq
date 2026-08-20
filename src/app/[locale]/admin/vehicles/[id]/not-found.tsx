import { Link } from "@/i18n/navigation";
import { Car } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// VEHICLE-LC3 — branded not-found for /admin/vehicles/[id]. Mirrors
// admin/providers/[id]/not-found.tsx's convention.

export default async function AdminVehicleNotFound() {
  const t = await getServerTranslator("admin");

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-8 py-20 text-center">
      <Car size={32} strokeWidth={1.5} className="text-foreground/25" />
      <p className="text-foreground/60">{t("vehicleReviewNotFoundMessage")}</p>
      <Link
        href="/admin/vehicles"
        className="mt-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        {t("backToVehiclesLabel")}
      </Link>
    </div>
  );
}
