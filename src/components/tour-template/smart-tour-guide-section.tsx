"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Plus, X, ShieldCheck, Star } from "lucide-react";
import { clsx } from "@/components/ui/clsx";
import {
  emptyTourFormState,
  applyPackageChange,
  buildGuidingContentPayload,
  vehicleVisibleFor,
  vehicleRequiredFor,
  forcedVehicleTypeFor,
  type TourFormState,
} from "@/lib/tour-template/form/tour-form-state";
import { isFieldVisible, isFieldRequired } from "@/lib/tour-template/form/field-rules";
import { TOUR_DIFFICULTY_LEVELS } from "@/lib/tour-template/guiding-content";
import type { TourPackageKey } from "@/lib/tour-template/packages";
import type { TourVehicleCode } from "@/lib/tour-template/vehicle-types";
import type { SmartTourFormConfig } from "@/lib/tour-template/form/get-smart-tour-form-config";
import type { GuideProfileSummary } from "@/lib/tour-template/form/guide-profile";

// Smart Tour-Guide provider section (TOUR-2). A conditional section that renders
// only for an eligible individual tourist-guide service (its parent decides). It
// holds the tour form state, serializes it to the TOUR-1 guidingContent v1 shape
// via the shared buildGuidingContentPayload(), and emits ONE hidden
// `guidingContent` input — the server re-validates with parseGuidingContent(), so
// this UI is convenience, never the security boundary. RTL-safe (logical props);
// package/vehicle semantics come from the app-owned helpers, not React.

type Props = {
  config: SmartTourFormConfig;
  guideProfile: GuideProfileSummary;
  initialState: TourFormState | null;
  malformed: boolean;
};

const INPUT_CLASS =
  "rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

export function SmartTourGuideSection({ config, guideProfile, initialState, malformed }: Props) {
  const t = useTranslations("provider");
  const fallbackPackage = (config.packages[0]?.key ?? "GUIDE_ONLY") as TourPackageKey;
  const [state, setState] = useState<TourFormState>(initialState ?? emptyTourFormState(fallbackPackage));

  const payload = useMemo(() => JSON.stringify(buildGuidingContentPayload(state)), [state]);

  const set = <K extends keyof TourFormState>(key: K, value: TourFormState[K]) =>
    setState((prev) => ({ ...prev, [key]: value }));

  const setVehicle = (patch: Partial<TourFormState["vehicle"]>) =>
    setState((prev) => ({ ...prev, vehicle: { ...prev.vehicle, ...patch } }));

  const showVehicle = vehicleVisibleFor(state.packageType);
  const vehicleRequired = vehicleRequiredFor(state.packageType);
  const forcedType = forcedVehicleTypeFor(state.packageType);
  const rules = config.fields;
  const visible = (key: Parameters<typeof isFieldVisible>[1]) => isFieldVisible(rules, key);
  const required = (key: Parameters<typeof isFieldRequired>[1]) => isFieldRequired(rules, key);

  return (
    <section className="flex flex-col gap-6 rounded-2xl border border-primary/20 bg-primary/5 p-5" aria-label={t("tourSectionTitle")}>
      {/* Hidden serialized payload — the ONLY thing submitted to the server. */}
      <input type="hidden" name="guidingContent" value={payload} />

      {malformed && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {t("tourMalformedNotice")}
        </p>
      )}

      {config.intro && <p className="text-sm text-foreground/70">{config.intro}</p>}

      {/* Guide profile preview — read-only, never duplicated into guidingContent. */}
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
        {guideProfile.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- provider Supabase host; next/image remotePatterns is a post-launch follow-up
          <img src={guideProfile.logoUrl} alt="" className="h-12 w-12 shrink-0 rounded-full border border-border object-cover" />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {guideProfile.name.slice(0, 1)}
          </span>
        )}
        <div className="flex min-w-0 flex-col">
          <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            {guideProfile.name}
            {guideProfile.isApproved && <ShieldCheck size={14} className="text-primary" aria-label={t("tourGuideVerifiedLabel")} />}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-foreground/50">
            {guideProfile.city && <span>{guideProfile.city}</span>}
            {guideProfile.reviewCount > 0 && guideProfile.averageRating !== null && (
              <span className="inline-flex items-center gap-0.5">
                <Star size={12} className="text-amber-500" />
                {guideProfile.averageRating.toFixed(1)} ({guideProfile.reviewCount})
              </span>
            )}
            {guideProfile.activityLabel && <span>{guideProfile.activityLabel}</span>}
          </span>
        </div>
        <Link href="/provider/settings" className="ms-auto shrink-0 text-xs font-medium text-primary hover:underline">
          {t("tourEditProfileLink")}
        </Link>
      </div>

      {/* Package selector — accessible radio cards. */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-medium text-foreground/50">{t("tourPackageSectionTitle")}</legend>
        <div role="radiogroup" aria-label={t("tourPackageSectionTitle")} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {config.packages.map((pkg) => {
            const selected = state.packageType === pkg.key;
            return (
              <button
                key={pkg.key}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setState((prev) => applyPackageChange(prev, pkg.key))}
                className={clsx(
                  "flex flex-col gap-1 rounded-xl border p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  selected ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-foreground/5"
                )}
              >
                <span className={clsx("text-sm font-medium", selected ? "text-primary" : "text-foreground")}>{pkg.label}</span>
                {pkg.description && <span className="text-xs text-foreground/50">{pkg.description}</span>}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Vehicle section — visibility from package semantics (app-owned). */}
      {showVehicle && (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-xs font-medium text-foreground/50">
            {t("tourVehicleSectionTitle")}
            {vehicleRequired && <span className="text-danger"> *</span>}
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-foreground/50">{t("tourVehicleType")}</span>
              <select
                className={INPUT_CLASS}
                value={forcedType ?? state.vehicle.type}
                disabled={forcedType !== null}
                onChange={(e) => setVehicle({ type: e.target.value as TourVehicleCode | "" })}
              >
                <option value="">{t("tourVehicleTypePlaceholder")}</option>
                {config.vehicleTypes.map((v) => (
                  <option key={v.code} value={v.code}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            {visible("vehicleMake") && (
              <TextInput label={t("tourVehicleMake")} value={state.vehicle.make} onChange={(v) => setVehicle({ make: v })} />
            )}
            {visible("vehicleModel") && (
              <TextInput label={t("tourVehicleModel")} value={state.vehicle.model} onChange={(v) => setVehicle({ model: v })} />
            )}
            {visible("vehicleYear") && (
              <TextInput label={t("tourVehicleYear")} value={state.vehicle.year} onChange={(v) => setVehicle({ year: v })} inputMode="numeric" />
            )}
            {visible("vehicleCapacity") && (
              <TextInput
                label={t("tourVehicleCapacity")}
                value={state.vehicle.passengerCapacity}
                onChange={(v) => setVehicle({ passengerCapacity: v })}
                inputMode="numeric"
              />
            )}
          </div>
        </fieldset>
      )}

      {/* Tour detail fields — field-rule driven (visible/required/order). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {visible("duration") && (
          <TextInput label={requiredLabel(t("tourFieldDuration"), required("duration"))} value={state.durationMinutes} onChange={(v) => set("durationMinutes", v)} inputMode="numeric" />
        )}
        {visible("maxGuests") && (
          <TextInput label={requiredLabel(t("tourFieldMaxGuests"), required("maxGuests"))} value={state.maxGuests} onChange={(v) => set("maxGuests", v)} inputMode="numeric" />
        )}
        {visible("difficulty") && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-foreground/50">{requiredLabel(t("tourFieldDifficulty"), required("difficulty"))}</span>
            <select className={INPUT_CLASS} value={state.difficulty} onChange={(e) => set("difficulty", e.target.value as TourFormState["difficulty"])}>
              <option value="">{t("tourNotSpecified")}</option>
              {TOUR_DIFFICULTY_LEVELS.map((d) => (
                <option key={d} value={d}>
                  {t(`tourDifficulty_${d}`)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {visible("meetingPoint") && (
        <TextInput label={requiredLabel(t("tourFieldMeetingPoint"), required("meetingPoint"))} value={state.meetingPoint} onChange={(v) => set("meetingPoint", v)} />
      )}

      {/* Pickup group */}
      <div className="flex flex-col gap-2">
        {visible("pickupIncluded") && (
          <Checkbox label={t("tourFieldPickupIncluded")} checked={state.pickupIncluded} onChange={(v) => set("pickupIncluded", v)} />
        )}
        {state.pickupIncluded && (
          <div className="grid grid-cols-1 gap-3 ps-1 sm:grid-cols-2">
            {visible("pickupArea") && <TextInput label={t("tourFieldPickupArea")} value={state.pickupArea} onChange={(v) => set("pickupArea", v)} />}
            {visible("hotelPickup") && <Checkbox label={t("tourFieldHotelPickup")} checked={state.hotelPickup} onChange={(v) => set("hotelPickup", v)} />}
            {visible("airportPickup") && <Checkbox label={t("tourFieldAirportPickup")} checked={state.airportPickup} onChange={(v) => set("airportPickup", v)} />}
          </div>
        )}
      </div>

      {visible("languages") && <TextArea label={requiredLabel(t("tourFieldLanguages"), required("languages"))} value={state.languages} onChange={(v) => set("languages", v)} />}

      {visible("itinerary") && (
        <ItineraryEditor
          label={requiredLabel(t("tourFieldItinerary"), required("itinerary"))}
          addLabel={t("tourItineraryAdd")}
          titleLabel={t("tourItineraryStopTitle")}
          descLabel={t("tourItineraryStopDescription")}
          removeLabel={t("tourItineraryRemove")}
          stops={state.itinerary}
          onChange={(v) => set("itinerary", v)}
        />
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {visible("includedItems") && <TextArea label={t("tourFieldIncluded")} value={state.includedItems} onChange={(v) => set("includedItems", v)} />}
        {visible("excludedItems") && <TextArea label={t("tourFieldExcluded")} value={state.excludedItems} onChange={(v) => set("excludedItems", v)} />}
      </div>

      {visible("recommendedEquipment") && (
        <TextArea label={t("tourFieldEquipment")} value={state.recommendedEquipment} onChange={(v) => set("recommendedEquipment", v)} />
      )}

      <div className="flex flex-wrap gap-4">
        {visible("childFriendly") && <Checkbox label={t("tourFieldChildFriendly")} checked={state.childFriendly === true} onChange={(v) => set("childFriendly", v ? true : null)} />}
        {visible("privateTour") && <Checkbox label={t("tourFieldPrivateTour")} checked={state.privateTour === true} onChange={(v) => set("privateTour", v ? true : null)} />}
        {visible("refreshmentsIncluded") && (
          <Checkbox label={t("tourFieldRefreshments")} checked={state.refreshmentsIncluded === true} onChange={(v) => set("refreshmentsIncluded", v ? true : null)} />
        )}
      </div>

      {visible("importantNotes") && <TextArea label={t("tourFieldNotes")} value={state.importantNotes} onChange={(v) => set("importantNotes", v)} />}
    </section>
  );
}

// Append a required marker to an ALREADY-RESOLVED label string (keeps t() calls
// keyed on literals so next-intl's typed keys are satisfied).
function requiredLabel(text: string, isRequired: boolean): string {
  return isRequired ? `${text} *` : text;
}

function TextInput({
  label,
  value,
  onChange,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: "numeric" | "decimal";
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-foreground/50">{label}</span>
      <input type="text" inputMode={inputMode} value={value} onChange={(e) => onChange(e.target.value)} className={INPUT_CLASS} />
    </label>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-foreground/50">{label}</span>
      <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} className={INPUT_CLASS} />
    </label>
  );
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-foreground/80">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30" />
      {label}
    </label>
  );
}

function ItineraryEditor({
  label,
  addLabel,
  titleLabel,
  descLabel,
  removeLabel,
  stops,
  onChange,
}: {
  label: string;
  addLabel: string;
  titleLabel: string;
  descLabel: string;
  removeLabel: string;
  stops: { title: string; description: string }[];
  onChange: (v: { title: string; description: string }[]) => void;
}) {
  const update = (index: number, patch: Partial<{ title: string; description: string }>) =>
    onChange(stops.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-foreground/50">{label}</span>
      {stops.map((stop, index) => (
        <div key={index} className="flex items-start gap-2 rounded-xl border border-border bg-card p-2">
          <div className="flex flex-1 flex-col gap-2">
            <input type="text" aria-label={titleLabel} placeholder={titleLabel} value={stop.title} onChange={(e) => update(index, { title: e.target.value })} className={INPUT_CLASS} />
            <input type="text" aria-label={descLabel} placeholder={descLabel} value={stop.description} onChange={(e) => update(index, { description: e.target.value })} className={INPUT_CLASS} />
          </div>
          <button type="button" aria-label={removeLabel} onClick={() => onChange(stops.filter((_, i) => i !== index))} className="mt-1 text-foreground/40 hover:text-danger">
            <X size={16} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...stops, { title: "", description: "" }])}
        className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 hover:bg-foreground/5"
      >
        <Plus size={14} />
        {addLabel}
      </button>
    </div>
  );
}
