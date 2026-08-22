import { getLocale } from "next-intl/server";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import { buildVehicleTitle } from "@/lib/vehicles/vehicle-title";
import { vehicleTypeOptions } from "@/lib/vehicles/vehicle-type-options";
import type { PoolVehicleView, TourVehiclePoolView } from "@/lib/tour-template/vehicle-pool/pool-view";
import type { VehicleAssignmentBlocker } from "@/lib/tour-template/vehicle-pool/vehicle-assignment";

// TOUR-VEHICLE-2 — the provider vehicle-pool section on the tour-service edit page.
// Server component, progressively enhanced: add/remove are native <form> POSTs bound to
// server actions passed from the page (no client JS), mirroring the media block. The
// server read model (TourVehiclePoolView) is authoritative — this only renders it. It
// NEVER receives registrationNumber, documents, objectKey, or the raw trusted flag (the
// slim PoolVehicleView carries none of them).

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

type Props = {
  view: TourVehiclePoolView;
  addAction: (formData: FormData) => void | Promise<void>;
  removeAction: (formData: FormData) => void | Promise<void>;
  notice?: "added" | "removed" | null;
  errorMessage?: string | null;
};

export async function VehiclePoolSection({ view, addAction, removeAction, notice, errorMessage }: Props) {
  const t = await getServerTranslator("provider");
  const locale = await getLocale();
  const typeLabels = new Map(vehicleTypeOptions(locale).map((o) => [o.code, o.label]));

  const facts = (v: PoolVehicleView) =>
    [
      v.modelYear ? String(v.modelYear) : null,
      v.vehicleType ? (typeLabels.get(v.vehicleType) ?? v.vehicleType) : null,
      v.color,
      v.passengerCapacity != null ? `${v.passengerCapacity} ${t("tourVehiclePoolGuestsSuffix")}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

  const blockerList = (v: PoolVehicleView) => (
    <ul className="mt-1 flex flex-col gap-0.5">
      {v.blockers.map((b) => (
        <li key={b} className="text-xs text-danger">
          {t(BLOCKER_KEYS[b])}
        </li>
      ))}
    </ul>
  );

  const title = (v: PoolVehicleView) => buildVehicleTitle(v.make, v.model) ?? t("vehicleUntitled");

  const eligibleAvailable = view.available.filter((v) => v.eligible);
  const ineligibleAvailable = view.available.filter((v) => !v.eligible);

  return (
    <Card hoverLift={false}>
      <div className="flex flex-col gap-5">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t("tourVehiclePoolTitle")}</h2>
          <p className="mt-0.5 text-xs text-foreground/50">{t("tourVehiclePoolSubtitle")}</p>
        </div>

        {notice === "added" && <Alert variant="success">{t("tourVehiclePoolAddedLabel")}</Alert>}
        {notice === "removed" && <Alert variant="success">{t("tourVehiclePoolRemovedLabel")}</Alert>}
        {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

        {!view.vehicleAllowed ? (
          // GUIDE_ONLY — no vehicle is required; no selector, no pool.
          <p className="text-xs text-foreground/60">{t("tourVehiclePoolGuideOnlyNote")}</p>
        ) : (
          <>
            {/* Configured pool */}
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-foreground/70">{t("tourVehiclePoolConfiguredTitle")}</h3>
              {view.pool.length === 0 ? (
                <p className="text-xs text-foreground/40">{t("tourVehiclePoolNoneConfigured")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {view.pool.map((v) => (
                    <li
                      key={v.vehicleId}
                      className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border p-3"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{title(v)}</span>
                          {v.isFourByFour && <Badge variant="info">{t("tourVehiclePool4x4Badge")}</Badge>}
                          {v.eligible ? (
                            <Badge variant="success">{t("tourVehiclePoolEligibleBadge")}</Badge>
                          ) : (
                            <Badge variant="warning">{t("tourVehiclePoolUnavailableBadge")}</Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-foreground/50">{facts(v)}</p>
                        {!v.eligible && blockerList(v)}
                      </div>
                      <form action={removeAction}>
                        <input type="hidden" name="vehicleId" value={v.vehicleId} />
                        <button
                          type="submit"
                          className="rounded-full border border-border px-4 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/10"
                        >
                          {t("tourVehiclePoolRemoveButton")}
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Add candidates */}
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-foreground/70">{t("tourVehiclePoolAvailableTitle")}</h3>

              {eligibleAvailable.length === 0 && view.pool.length === 0 && ineligibleAvailable.length === 0 ? (
                <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-border p-4">
                  <p className="text-xs text-foreground/50">{t("tourVehiclePoolNoVehiclesEmptyState")}</p>
                  <Link
                    href="/provider/vehicles"
                    className="text-xs font-medium text-primary transition-opacity hover:opacity-80"
                  >
                    {t("tourVehiclePoolManageVehiclesCta")}
                  </Link>
                </div>
              ) : (
                <>
                  {eligibleAvailable.length === 0 ? (
                    <p className="text-xs text-foreground/40">{t("tourVehiclePoolNoEligibleToAdd")}</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {eligibleAvailable.map((v) => (
                        <li
                          key={v.vehicleId}
                          className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border p-3"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-foreground">{title(v)}</span>
                              {v.isFourByFour && <Badge variant="info">{t("tourVehiclePool4x4Badge")}</Badge>}
                            </div>
                            <p className="mt-0.5 text-xs text-foreground/50">{facts(v)}</p>
                          </div>
                          <form action={addAction}>
                            <input type="hidden" name="vehicleId" value={v.vehicleId} />
                            <button
                              type="submit"
                              className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
                            >
                              {t("tourVehiclePoolAddButton")}
                            </button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Owned-but-not-yet-eligible vehicles, read-only with reasons. */}
                  {ineligibleAvailable.length > 0 && (
                    <div className="mt-1 flex flex-col gap-2">
                      <h4 className="text-xs font-medium text-foreground/40">{t("tourVehiclePoolNotEligibleTitle")}</h4>
                      <ul className="flex flex-col gap-2">
                        {ineligibleAvailable.map((v) => (
                          <li key={v.vehicleId} className="rounded-xl border border-dashed border-border p-3 opacity-70">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-foreground">{title(v)}</span>
                              {v.isFourByFour && <Badge variant="info">{t("tourVehiclePool4x4Badge")}</Badge>}
                            </div>
                            <p className="mt-0.5 text-xs text-foreground/50">{facts(v)}</p>
                            {blockerList(v)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <Link
                    href="/provider/vehicles"
                    className="mt-1 w-fit text-xs font-medium text-primary transition-opacity hover:opacity-80"
                  >
                    {t("tourVehiclePoolManageVehiclesCta")}
                  </Link>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
