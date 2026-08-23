import { getLocale } from "next-intl/server";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { Badge } from "@/components/ui/badge";
import { buildVehicleTitle } from "@/lib/vehicles/vehicle-title";
import { vehicleTypeOptions } from "@/lib/vehicles/vehicle-type-options";
import type {
  BookingAcceptanceVehicleOptions,
  AcceptanceVehicleCandidate,
} from "@/lib/provider/queries/get-booking-acceptance-vehicles";
import type { VehicleAssignmentBlocker } from "@/lib/tour-template/vehicle-pool/vehicle-assignment";

// BOOKING-VEHICLE-1 — the provider's vehicle chooser rendered INSIDE the Accept <form> on
// the booking detail page. The eligible candidates are radio inputs (name="vehicleId") so
// the server action receives the chosen vehicle; ineligible pooled vehicles are shown
// read-only with their blocker reasons (§27). When exactly one eligible vehicle exists AND
// the package requires one, it is pre-selected — but the provider must still press Accept
// (§10). It renders ONLY the customer/owner-safe candidate fields (never registration).

// Same blocker → provider-namespace i18n keys the TOUR-VEHICLE-2 pool section uses (already
// present in every locale), so an ineligible candidate reads identically on both surfaces.
const BLOCKER_KEYS = {
  PACKAGE_FORBIDS_VEHICLE: "tourVehiclePoolBlockerPackageForbids",
  NOT_ACTIVE: "tourVehiclePoolBlockerNotActive",
  VERIFICATION_NOT_APPROVED: "tourVehiclePoolBlockerVerificationNotApproved",
  REQUIRED_DOCUMENT_MISSING: "tourVehiclePoolBlockerDocMissing",
  REQUIRED_DOCUMENT_NOT_APPROVED: "tourVehiclePoolBlockerDocNotApproved",
  REQUIRED_DOCUMENT_EXPIRED: "tourVehiclePoolBlockerDocExpired",
  NOT_FOUR_BY_FOUR_CAPABLE: "tourVehiclePoolBlockerNot4x4",
  INSUFFICIENT_GUEST_CAPACITY: "tourVehiclePoolBlockerCapacity",
} as const satisfies Record<VehicleAssignmentBlocker, string>;

export async function BookingAcceptanceVehiclePicker({ options }: { options: BookingAcceptanceVehicleOptions }) {
  const t = await getServerTranslator("provider");
  const locale = await getLocale();
  const typeLabels = new Map(vehicleTypeOptions(locale).map((o) => [o.code, o.label]));

  const facts = (v: AcceptanceVehicleCandidate) =>
    [
      v.modelYear ? String(v.modelYear) : null,
      v.vehicleType ? (typeLabels.get(v.vehicleType) ?? v.vehicleType) : null,
      v.color,
      v.passengerCapacity != null ? `${v.passengerCapacity} ${t("tourVehiclePoolGuestsSuffix")}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

  const title = (v: AcceptanceVehicleCandidate) => buildVehicleTitle(v.make, v.model) ?? t("vehicleUntitled");

  // BOOKING-CONFLICT-1C — three distinct states. `busy` (server-derived) is an
  // otherwise-ELIGIBLE vehicle already reserved for an overlapping window: it cannot be
  // selected now, but it is NOT an eligibility blocker — shown separately from the ineligible
  // (blocker) list. Eligibility is the more fundamental gate, so a vehicle that is both
  // ineligible and busy shows under ineligible with its blockers.
  const selectable = options.candidates.filter((c) => c.eligible && !c.busy);
  const busy = options.candidates.filter((c) => c.eligible && c.busy);
  const ineligible = options.candidates.filter((c) => !c.eligible);
  // Pre-select only when the package requires a vehicle and there is exactly one SELECTABLE.
  const preselectId = options.vehicleRequired && selectable.length === 1 ? selectable[0]!.vehicleId : null;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{t("acceptVehicleSelectHeading")}</h3>
        {options.vehicleRequired && <p className="mt-0.5 text-xs text-foreground/50">{t("acceptVehicleRequiredHint")}</p>}
      </div>

      {selectable.length === 0 ? (
        <p className="text-xs text-danger">{t("acceptVehicleNoneEligible")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {selectable.map((v) => (
            <li key={v.vehicleId}>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 transition-colors hover:bg-accent/10">
                <input
                  type="radio"
                  name="vehicleId"
                  value={v.vehicleId}
                  defaultChecked={preselectId === v.vehicleId}
                  className="mt-1 shrink-0"
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{title(v)}</span>
                    {v.isFourByFour && <Badge variant="info">{t("tourVehiclePool4x4Badge")}</Badge>}
                  </span>
                  <span className="mt-0.5 block text-xs text-foreground/50">{facts(v)}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {busy.length > 0 && (
        <ul className="flex flex-col gap-2">
          {busy.map((v) => (
            <li key={v.vehicleId} className="rounded-xl border border-dashed border-border p-3 opacity-70">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">{title(v)}</span>
                {v.isFourByFour && <Badge variant="info">{t("tourVehiclePool4x4Badge")}</Badge>}
                <Badge variant="warning">{t("acceptVehicleBusyBadge")}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-foreground/50">{facts(v)}</p>
              {/* Generic reason only — never the conflicting booking / customer / interval. */}
              <p className="mt-1 text-xs text-danger">{t("acceptVehicleBusyReason")}</p>
            </li>
          ))}
        </ul>
      )}

      {ineligible.length > 0 && (
        <ul className="flex flex-col gap-2">
          {ineligible.map((v) => (
            <li key={v.vehicleId} className="rounded-xl border border-dashed border-border p-3 opacity-70">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">{title(v)}</span>
                {v.isFourByFour && <Badge variant="info">{t("tourVehiclePool4x4Badge")}</Badge>}
                <Badge variant="warning">{t("tourVehiclePoolUnavailableBadge")}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-foreground/50">{facts(v)}</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {v.blockers.map((b) => (
                  <li key={b} className="text-xs text-danger">
                    {t(BLOCKER_KEYS[b])}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
