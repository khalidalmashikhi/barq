import { getLocale } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buildVehicleTitle } from "@/lib/vehicles/vehicle-title";
import { vehicleTypeOptions } from "@/lib/vehicles/vehicle-type-options";

// BOOKING-VEHICLE-2 — the specific vehicle assigned to THIS booking (historical snapshot),
// shown on the customer and provider Booking detail pages. This is deliberately distinct
// from the TOUR-VEHICLE-3 Service-page card (which shows representative/currently-eligible
// pooled vehicles): this one is the committed assignment, never "examples". Presentation
// only — no selector, no action. The customer variant passes no `registrationNumber`; the
// provider variant passes the live plate plus a `plate` label. Labels are resolved by the
// caller from its own i18n namespace so this one component serves both audiences.

export type AssignedVehicleCardView = {
  make: string | null;
  model: string | null;
  modelYear: number | null;
  color: string | null;
  passengerCapacity: number | null;
  vehicleType: string | null;
  isFourByFour: boolean;
  /** Provider-only live plate. Omitted/undefined for the customer variant. */
  registrationNumber?: string | null;
};

export type AssignedVehicleCardLabels = {
  title: string;
  untitled: string;
  guestsSuffix: string;
  fourByFour: string;
  /** Provider-only. When present AND a registrationNumber is given, the plate row renders. */
  plate?: string;
};

export async function AssignedVehicleCard({
  vehicle,
  labels,
}: {
  vehicle: AssignedVehicleCardView;
  labels: AssignedVehicleCardLabels;
}) {
  const locale = await getLocale();
  const typeLabels = new Map(vehicleTypeOptions(locale).map((o) => [o.code, o.label]));

  const title = buildVehicleTitle(vehicle.make, vehicle.model) ?? labels.untitled;
  const facts = [
    vehicle.modelYear ? String(vehicle.modelYear) : null,
    vehicle.vehicleType ? (typeLabels.get(vehicle.vehicleType) ?? vehicle.vehicleType) : null,
    vehicle.color,
    vehicle.passengerCapacity != null ? `${vehicle.passengerCapacity} ${labels.guestsSuffix}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const showPlate = Boolean(labels.plate && vehicle.registrationNumber);

  return (
    <Card hoverLift={false}>
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">{labels.title}</h2>
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{title}</span>
            {vehicle.isFourByFour && <Badge variant="info">{labels.fourByFour}</Badge>}
          </div>
          {facts && <p className="text-xs text-foreground/50">{facts}</p>}
          {showPlate && (
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-foreground/50">{labels.plate}</span>
              <span className="font-medium text-foreground">{vehicle.registrationNumber}</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
