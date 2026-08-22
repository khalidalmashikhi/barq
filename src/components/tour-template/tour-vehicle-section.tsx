import { getLocale } from "next-intl/server";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buildVehicleTitle } from "@/lib/vehicles/vehicle-title";
import { vehicleTypeOptions } from "@/lib/vehicles/vehicle-type-options";
import type { PublicTourVehicleSummary, PublicTourVehicle } from "@/lib/tour-template/vehicle-pool/public-tour-vehicles";

// TOUR-VEHICLE-3 — the CUSTOMER-FACING tour vehicle presentation. Server component; renders
// only the safe summary it is given (the read model already filtered to currently-eligible
// pooled vehicles and stripped every private field). HONEST framing: vehicles are shown as
// examples currently configured for the tour, NEVER as an assigned/guaranteed vehicle
// (Booking.vehicleId is unwired). A transport tour with no currently-eligible vehicle shows
// the transport promise plus a safe "details currently unavailable" note — never stale data.

type Props = { summary: PublicTourVehicleSummary };

export async function TourVehicleSection({ summary }: Props) {
  const t = await getServerTranslator("services");
  const locale = await getLocale();
  const typeLabels = new Map(vehicleTypeOptions(locale).map((o) => [o.code, o.label]));

  const facts = (v: PublicTourVehicle) =>
    [
      v.modelYear ? String(v.modelYear) : null,
      v.vehicleType ? (typeLabels.get(v.vehicleType) ?? v.vehicleType) : null,
      v.color,
      v.passengerCapacity != null ? `${v.passengerCapacity} ${t("tourVehicleGuestsSuffix")}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <Card hoverLift={false}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-foreground">{t("tourTransportHeading")}</h2>
          {summary.transportIncluded && <Badge variant="success">{t("tourTransportIncluded")}</Badge>}
          {summary.requiresFourByFour && <Badge variant="info">{t("tourVerified4x4")}</Badge>}
        </div>

        {summary.vehicles.length > 0 ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-medium text-foreground/70">{t("tourVehiclesHeading")}</h3>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {summary.vehicles.map((v, i) => (
                <li key={i} className="rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {buildVehicleTitle(v.make, v.model) ?? t("tourVehicleUntitled")}
                    </span>
                    {v.isFourByFour && <Badge variant="info">{t("tourVehicle4x4Badge")}</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-foreground/50">{facts(v)}</p>
                </li>
              ))}
            </ul>
            <p className="text-xs text-foreground/50">{t("tourVehiclesRepresentativeNote")}</p>
          </div>
        ) : (
          // Transport-promised tour that is temporarily degraded (no currently-eligible
          // vehicle). Show the promise, not stale vehicle data.
          <p className="text-xs text-foreground/50">{t("tourVehicleUnavailable")}</p>
        )}
      </div>
    </Card>
  );
}
