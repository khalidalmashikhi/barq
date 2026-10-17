"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarDays, Check, Map as MapIcon, Minus, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { formatMoney } from "@/lib/i18n/format-money";
import { describeDuration } from "@/lib/services/duration";
import type { RegionCode } from "@/lib/regions";
import { parseTripInput, tripInputSignature, TRIP_INTERESTS, TRIP_MAX_DAYS, TRIP_MAX_PARTY, TRIP_MOBILITY, TRIP_PACES, type TripInterest, type TripMobility, type TripPace } from "@/lib/trips/trip-input";
import { TRIP_PERIODS, type TripBarqItem, type TripDay, type TripItem, type TripMoney, type TripPeriod, type TripPlan } from "@/lib/trips/trip-plan";
import { hasBarqService, isCurrentResponse, moveItem, removeItem, replaceDay, replaceItem, servicesOutside } from "@/lib/trips/trip-plan-editing";

// 2026-10-17 — Trip planner, grounded foundation: the customer island. A short step-by-step input
// (region → days → optional preferences), then a clean sequence of DAY CARDS. Every BARQ item came
// from published BARQ services (server-side); general suggestions are labelled as such and are not
// bookable. Nothing is booked: "Continue to booking" first RE-READS price, slot and seats
// (`/api/v1/trips/revalidate`) and only then opens the service page, where the booking flow checks
// everything again. Guards: one request at a time (in-flight ref — a double tap sends one), and a
// response is applied only if it is the LATEST one for the CURRENT preferences (stale responses
// dropped). No storage, no analytics, nothing about the customer is sent beyond the preferences.

type Region = { code: RegionCode; label: string };
type Phase = "region" | "days" | "prefs" | "plan";
type Status = "DRAFT_INPUT" | "GENERATING" | "READY" | "PARTIALLY_AVAILABLE" | "FAILED_RETRYABLE";
type ErrorKind = "retryable" | "rateLimited" | "invalid";
type Check = { state: "checking" } | { state: "PRICE_CHANGED"; cost: TripMoney | null } | { state: "NO_SLOT_ON_DATE" } | { state: "NO_LONGER_AVAILABLE" } | { state: "failed" };

const PRIMARY = "inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-base font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-foreground/15 disabled:text-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2";
const SECONDARY = "inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-primary/25 bg-card px-5 text-base font-semibold text-primary hover:bg-primary/5 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2";
const SMALL = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-foreground/5 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
const CARD = "rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6";
const CHOICE = "flex min-h-12 items-center justify-center gap-2 rounded-2xl border px-3 py-2 text-center text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 aria-pressed:border-primary aria-pressed:bg-primary/5 aria-pressed:text-primary";
const SELECT = "min-h-11 rounded-xl border border-border bg-card px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

export function TripPlanner({ regions }: { regions: Region[] }) {
  const t = useTranslations("trips");
  const ts = useTranslations("services");
  const td = t as unknown as (key: string, values?: Record<string, string | number>) => string;
  const tsd = ts as unknown as (key: string, values?: Record<string, string | number>) => string;
  const locale = useLocale();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("region");
  const [regionCode, setRegionCode] = useState<RegionCode | null>(null);
  const [days, setDays] = useState(3);
  const [startDate, setStartDate] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [interests, setInterests] = useState<TripInterest[]>([]);
  const [pace, setPace] = useState<TripPace>("balanced");
  const [budget, setBudget] = useState("");
  const [mobility, setMobility] = useState<TripMobility>("own");
  const [needs, setNeeds] = useState({ accessibility: false, family: false });
  const [status, setStatus] = useState<Status>("DRAFT_INPUT");
  const [error, setError] = useState<ErrorKind | null>(null);
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [busyDay, setBusyDay] = useState<number | null>(null);
  const [unchangedDay, setUnchangedDay] = useState<number | null>(null);
  const [checks, setChecks] = useState<Record<string, Check>>({});

  // One request at a time; only the latest response for the current preferences is applied.
  const inFlight = useRef(false);
  const latestSeq = useRef(0);
  const variant = useRef(0);
  const currentSignature = useRef("");
  const checking = useRef(new Set<string>()); // per-item revalidation in flight (a double tap sends ONE request)

  const rawInput = (over: Partial<{ pace: TripPace }> = {}) => ({
    regionCode,
    days,
    ...(startDate ? { startDate } : {}),
    adults,
    children,
    interests,
    pace: over.pace ?? pace,
    ...(budget.trim() !== "" && Number.isInteger(Number(budget)) && Number(budget) > 0 ? { budgetPerPerson: Number(budget) } : {}),
    mobility,
    needs,
  });
  const parsedNow = parseTripInput(rawInput());
  currentSignature.current = parsedNow.ok ? tripInputSignature(parsedNow.value) : "";
  const regionLabel = regions.find((r) => r.code === regionCode)?.label ?? "";

  const post = async (url: string, body: unknown) => {
    const res = await fetch(`${url}?locale=${encodeURIComponent(locale)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { res, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  };
  const failWith = (res: Response) => setError(res.status === 429 ? "rateLimited" : res.status === 400 ? "invalid" : "retryable");

  /** After a failed generation: the plan on screen stays ONLY if it answers the same preferences. */
  const keepOrDropPlan = (signature: string) => {
    if (plan && plan.inputSignature === signature) return setStatus(plan.state);
    setPlan(null);
    setStatus("FAILED_RETRYABLE");
  };

  /** Generate the whole plan (optionally with a new pace). */
  const generate = async (over: Partial<{ pace: TripPace }> = {}, regenerate = false) => {
    if (inFlight.current) return;
    const input = rawInput(over);
    const parsed = parseTripInput(input);
    if (!parsed.ok) {
      setError("invalid");
      return;
    }
    inFlight.current = true;
    const seq = ++latestSeq.current;
    const signature = tripInputSignature(parsed.value);
    if (regenerate) variant.current += 1;
    setError(null);
    setStatus("GENERATING");
    setPhase("plan");
    try {
      const { res, json } = await post("/api/v1/trips/plan", { input, variant: variant.current });
      const next = json?.plan as TripPlan | undefined;
      if (!res.ok || !next) {
        failWith(res);
        keepOrDropPlan(signature);
        return;
      }
      // a newer request or changed preferences make this answer stale — drop it (never stay "generating")
      if (next.inputSignature !== signature || !isCurrentResponse(seq, latestSeq.current, next.inputSignature, currentSignature.current)) {
        if (seq === latestSeq.current) setStatus(plan ? plan.state : "FAILED_RETRYABLE");
        return;
      }
      setChecks({});
      setUnchangedDay(null);
      setPlan(next);
      setStatus(next.state);
    } catch {
      setError("retryable");
      keepOrDropPlan(signature);
    } finally {
      inFlight.current = false;
    }
  };

  /** Regenerate ONE day; every other day stays exactly as it is. */
  const regenerateDay = async (dayNumber: number) => {
    if (inFlight.current || !plan) return;
    inFlight.current = true;
    const seq = ++latestSeq.current;
    const signature = plan.inputSignature;
    variant.current += 1;
    setBusyDay(dayNumber);
    setUnchangedDay(null);
    setError(null);
    try {
      const { res, json } = await post("/api/v1/trips/plan", { input: rawInput(), regenerateDay: dayNumber, keepServiceIds: servicesOutside(plan, dayNumber), variant: variant.current });
      const day = json?.day as TripDay | undefined;
      if (!res.ok || !day) return failWith(res);
      if (!isCurrentResponse(seq, latestSeq.current, signature, currentSignature.current)) return;
      // nothing else fits → say so instead of a silent no-op
      if (JSON.stringify(plan.days.find((d) => d.dayNumber === dayNumber)) === JSON.stringify(day)) setUnchangedDay(dayNumber);
      setPlan((p) => (p ? replaceDay(p, day) : p));
    } catch {
      setError("retryable");
    } finally {
      inFlight.current = false;
      setBusyDay(null);
    }
  };

  /** Re-read price / slot / seats NOW, then open the service page (the booking flow checks again). */
  const continueToBooking = async (day: TripDay, item: TripBarqItem) => {
    const key = `${day.dayNumber}:${item.serviceId}`;
    if (checking.current.has(key)) return;
    checking.current.add(key);
    setChecks((c) => ({ ...c, [key]: { state: "checking" } }));
    try {
      const { res, json } = await post("/api/v1/trips/revalidate", { adults, children, items: [{ serviceId: item.serviceId, date: day.date, expectedCost: item.estimatedCost }] });
      const result = (json?.items as { status: string; currentCost: TripMoney | null }[] | undefined)?.[0];
      if (!res.ok || !result) {
        checking.current.delete(key);
        return setChecks((c) => ({ ...c, [key]: { state: "failed" } }));
      }
      if (result.status === "OK") {
        setChecks((c) => {
          const next = { ...c };
          delete next[key];
          return next;
        });
        router.push(`/services/${item.serviceId}`); // stays "in flight" while navigating
        return;
      }
      checking.current.delete(key);
      setChecks((c) => ({ ...c, [key]: result.status === "PRICE_CHANGED" ? { state: "PRICE_CHANGED", cost: result.currentCost } : { state: result.status as "NO_SLOT_ON_DATE" | "NO_LONGER_AVAILABLE" } }));
    } catch {
      checking.current.delete(key);
      setChecks((c) => ({ ...c, [key]: { state: "failed" } }));
    }
  };

  const money = (m: TripMoney) => (m.min === m.max ? formatMoney(m.min, m.currency, locale) : `${formatMoney(m.min, m.currency, locale)} – ${formatMoney(m.max, m.currency, locale)}`);
  const duration = (minutes: number) => {
    const d = describeDuration(minutes);
    return d.key === "durationHoursMinutes" ? tsd(d.key, { hours: d.hours, minutes: d.minutes }) : tsd(d.key, { count: d.count });
  };
  const dateLabel = (key: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-OM-u-nu-latn" : locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));
  const stepper = (label: string, value: number, set: (n: number) => void, min: number, max: number, id: string) => (
    <div className="flex items-center justify-between gap-3">
      <span id={id} className="text-base font-semibold text-foreground">
        {label}
      </span>
      <div className="flex items-center gap-2" role="group" aria-labelledby={id}>
        <button type="button" onClick={() => set(Math.max(min, value - 1))} disabled={value <= min} aria-label={t("decrease")} className={SMALL}>
          <Minus size={16} aria-hidden />
        </button>
        <span className="min-w-10 text-center text-lg font-semibold tabular-nums" aria-live="polite">
          {value}
        </span>
        <button type="button" onClick={() => set(Math.min(max, value + 1))} disabled={value >= max} aria-label={t("increase")} className={SMALL}>
          <Plus size={16} aria-hidden />
        </button>
      </div>
    </div>
  );

  // ── INPUT STEPS ────────────────────────────────────────────────────────────────────────────
  if (phase === "region") {
    return (
      <section className={CARD} aria-labelledby="trip-region-title">
        <h2 id="trip-region-title" className="mb-4 text-xl font-semibold text-foreground">
          {t("regionTitle")}
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {regions.map((r) => (
            <button
              key={r.code}
              type="button"
              aria-pressed={regionCode === r.code}
              onClick={() => {
                setRegionCode(r.code);
                setPhase("days");
              }}
              className={`${CHOICE} border-border bg-card text-foreground`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </section>
    );
  }

  if (phase === "days" || phase === "prefs") {
    return (
      <section className={`${CARD} flex flex-col gap-5`} aria-labelledby="trip-days-title">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-secondary-700">{regionLabel}</p>
          <h2 id="trip-days-title" className="text-xl font-semibold text-foreground">
            {phase === "days" ? t("daysTitle") : t("preferencesTitle")}
          </h2>
        </div>
        {stepper(td("daysCount", { count: days }), days, setDays, 1, TRIP_MAX_DAYS, "trip-days")}

        {phase === "prefs" && (
          <div className="flex flex-col gap-5 border-t border-border pt-5">
            <label className="flex flex-col gap-1.5">
              <span className="flex items-center gap-2 text-base font-semibold text-foreground">
                <CalendarDays size={18} aria-hidden /> {t("startDateLabel")}
              </span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="min-h-12 rounded-xl border border-foreground/15 bg-card px-3 text-base" />
              <span className="text-sm text-foreground/75">{t("startDateHint")}</span>
            </label>
            {stepper(t("adultsLabel"), adults, setAdults, 1, TRIP_MAX_PARTY - children, "trip-adults")}
            {stepper(t("childrenLabel"), children, setChildren, 0, TRIP_MAX_PARTY - adults, "trip-children")}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-base font-semibold text-foreground">{t("interestsLabel")}</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {TRIP_INTERESTS.map((i) => (
                  <button key={i} type="button" aria-pressed={interests.includes(i)} onClick={() => setInterests((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]))} className={`${CHOICE} border-border bg-card text-foreground`}>
                    {interests.includes(i) && <Check size={16} aria-hidden />}
                    {td(`interest_${i}`)}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-base font-semibold text-foreground">{t("paceLabel")}</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {TRIP_PACES.map((p) => (
                  <button key={p} type="button" aria-pressed={pace === p} onClick={() => setPace(p)} className={`${CHOICE} flex-col border-border bg-card text-foreground`}>
                    <span>{td(`pace_${p}`)}</span>
                    <span className="text-sm font-normal text-foreground/70">{td(`paceHint_${p}`)}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="flex flex-col gap-1.5">
              <span className="text-base font-semibold text-foreground">{t("budgetLabel")}</span>
              <span className="flex items-center gap-2">
                <input type="number" inputMode="numeric" min={1} value={budget} onChange={(e) => setBudget(e.target.value)} className="min-h-12 w-40 rounded-xl border border-foreground/15 bg-card px-3 text-base" dir="ltr" />
                <span className="text-sm text-foreground/75">{t("budgetUnit")}</span>
              </span>
            </label>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-base font-semibold text-foreground">{t("mobilityLabel")}</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {TRIP_MOBILITY.map((m) => (
                  <button key={m} type="button" aria-pressed={mobility === m} onClick={() => setMobility(m)} className={`${CHOICE} border-border bg-card text-foreground`}>
                    {td(`mobility_${m}`)}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-base font-semibold text-foreground">{t("needsLabel")}</legend>
              {(["accessibility", "family"] as const).map((n) => (
                <label key={n} className="flex min-h-11 items-center gap-3 text-base text-foreground">
                  <input type="checkbox" checked={needs[n]} onChange={(e) => setNeeds((cur) => ({ ...cur, [n]: e.target.checked }))} className="size-6 accent-primary" />
                  {n === "accessibility" ? t("needAccessibility") : t("needFamily")}
                </label>
              ))}
            </fieldset>
          </div>
        )}

        {error === "invalid" && (
          <p role="alert" className="rounded-2xl border border-danger/30 bg-danger/5 p-3 text-sm text-foreground">
            {t("errorInvalid")}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button type="button" onClick={() => generate()} className={`${PRIMARY} sm:min-w-56`}>
            <MapIcon size={18} aria-hidden /> {t("createPlan")}
          </button>
          {phase === "days" && (
            <button type="button" onClick={() => setPhase("prefs")} className={SECONDARY}>
              {t("addPreferences")}
            </button>
          )}
          <button type="button" onClick={() => setPhase(phase === "prefs" ? "days" : "region")} className="inline-flex min-h-12 items-center justify-center rounded-2xl px-4 text-base font-medium text-foreground/75 hover:bg-foreground/5">
            {t("back")}
          </button>
        </div>
      </section>
    );
  }

  // ── PLAN ───────────────────────────────────────────────────────────────────────────────────
  if (status === "GENERATING" || (!plan && status !== "FAILED_RETRYABLE")) {
    return (
      <section className={`${CARD} flex flex-col items-center gap-3 py-10 text-center`} role="status" aria-live="polite" data-trip-generating="">
        <span aria-hidden className="flex size-14 items-center justify-center rounded-2xl bg-secondary/10 text-secondary-700">
          <MapIcon size={26} className="motion-safe:animate-pulse" />
        </span>
        <p className="text-lg font-semibold text-foreground">{t("generating")}</p>
        <p className="text-sm text-foreground/75">{t("generatingHint")}</p>
      </section>
    );
  }

  if (!plan) {
    return (
      <section className={`${CARD} flex flex-col gap-4`} role="alert">
        <p className="text-base text-foreground">{error === "rateLimited" ? t("errorRateLimited") : error === "invalid" ? t("errorInvalid") : t("errorRetryable")}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => generate()} className={PRIMARY}>
            <RefreshCw size={18} aria-hidden /> {t("retry")}
          </button>
          <button type="button" onClick={() => setPhase("prefs")} className={SECONDARY}>
            {t("editPreferences")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-5" data-trip-plan="">
      <section className={`${CARD} flex flex-col gap-3`} aria-labelledby="trip-plan-title">
        <h2 id="trip-plan-title" className="text-2xl font-semibold text-foreground">
          {td("planTitle", { region: regions.find((r) => r.code === plan.regionCode)?.label ?? regionLabel })}
        </h2>
        <p className="text-base text-foreground/80">{t("planDisclaimer")}</p>
        {status === "PARTIALLY_AVAILABLE" && (
          <p className="rounded-2xl border border-warning/40 bg-warning/10 p-3 text-sm text-foreground" data-plan-notice="">
            {hasBarqService(plan) ? t("planPartial") : t("planNoServices")}
          </p>
        )}
        <p className="text-sm text-foreground/75">{t("travelTimeUnavailable")}</p>
        {error && (
          <p role="alert" className="text-sm font-medium text-danger">
            {error === "rateLimited" ? t("errorRateLimited") : t("errorRetryable")}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <button type="button" onClick={() => generate({}, true)} className={SMALL}>
            <RefreshCw size={16} aria-hidden /> {t("regeneratePlan")}
          </button>
          <label className="flex items-center gap-2 text-sm text-foreground">
            {t("changePace")}
            <select
              value={pace}
              onChange={(e) => {
                const next = e.target.value as TripPace;
                setPace(next);
                void generate({ pace: next });
              }}
              className={SELECT}
            >
              {TRIP_PACES.map((p) => (
                <option key={p} value={p}>
                  {td(`pace_${p}`)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => setPhase("prefs")} className={SMALL}>
            {t("editPreferences")}
          </button>
        </div>
      </section>

      <ol className="flex flex-col gap-5">
        {plan.days.map((day) => (
          <li key={day.dayNumber}>
            <section className={`${CARD} flex flex-col gap-4`} aria-labelledby={`trip-day-${day.dayNumber}`} data-trip-day={day.dayNumber}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id={`trip-day-${day.dayNumber}`} className="text-xl font-semibold text-foreground">
                  {td("dayTitle", { number: day.dayNumber })}
                  {day.date && <span className="ms-2 text-base font-normal text-foreground/70">{dateLabel(day.date)}</span>}
                </h3>
                <button type="button" onClick={() => regenerateDay(day.dayNumber)} disabled={busyDay !== null} className={SMALL}>
                  <RefreshCw size={16} aria-hidden className={busyDay === day.dayNumber ? "motion-safe:animate-spin" : ""} /> {t("regenerateDay")}
                </button>
              </div>
              <p role="status" className="text-base text-foreground/70 empty:hidden">
                {unchangedDay === day.dayNumber ? t("regenerateDayUnchanged") : null}
              </p>
              {TRIP_PERIODS.map((period) => (
                <div key={period} className="flex flex-col gap-2 border-t border-border pt-3" data-trip-period={period}>
                  <h4 className="text-sm font-semibold uppercase tracking-normal text-foreground/70">{td(`period_${period}`)}</h4>
                  {day.periods[period].map((item, index) => (
                    <TripItemCard
                      key={`${period}-${index}`}
                      item={item}
                      day={day}
                      period={period}
                      index={index}
                      plan={plan}
                      check={item.kind === "BARQ_SERVICE" ? checks[`${day.dayNumber}:${item.serviceId}`] : undefined}
                      onRemove={() => setPlan((p) => (p ? removeItem(p, day.dayNumber, period, index) : p))}
                      onMove={(to) => setPlan((p) => (p ? moveItem(p, day.dayNumber, period, index, to) : p))}
                      onReplace={(serviceId) => setPlan((p) => (p ? replaceItem(p, day.dayNumber, period, index, p.alternatives.find((a) => a.serviceId === serviceId)!) : p))}
                      onBook={() => item.kind === "BARQ_SERVICE" && continueToBooking(day, item)}
                      t={td}
                      money={money}
                      duration={duration}
                    />
                  ))}
                </div>
              ))}
              {day.estimatedCost && (
                <p className="text-sm font-medium text-foreground">
                  {td("dayCost", { range: money(day.estimatedCost) })}
                  {day.estimatedCost.partial && <span className="text-foreground/70"> ({t("dayCostPartial")})</span>}
                </p>
              )}
              {day.noteKeys.length > 0 && (
                <ul className="flex flex-col gap-1.5 rounded-2xl bg-background p-3">
                  {day.noteKeys.map((n) => (
                    <li key={n} className="text-sm text-foreground/80">
                      {td(n)}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TripItemCard(props: {
  item: TripItem;
  day: TripDay;
  period: TripPeriod;
  index: number;
  plan: TripPlan;
  check: Check | undefined;
  onRemove: () => void;
  onMove: (toDay: number) => void;
  onReplace: (serviceId: string) => void;
  onBook: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
  money: (m: TripMoney) => string;
  duration: (minutes: number) => string;
}) {
  const { item, day, plan, check, t, money, duration } = props;
  if (item.kind === "GENERAL_SUGGESTION") {
    return (
      <div className="flex flex-col gap-1 rounded-2xl border border-dashed border-foreground/20 p-3" data-trip-item="GENERAL_SUGGESTION">
        <span className="inline-flex w-fit rounded-full bg-foreground/5 px-2.5 py-0.5 text-xs font-medium text-foreground/75">{t("badgeGeneral")}</span>
        <p className="text-base text-foreground">{t(item.suggestionKey)}</p>
        <p className="text-sm text-foreground/70">{t("generalNote")}</p>
      </div>
    );
  }
  const confirmed = item.availability === "AVAILABLE_ON_DATE" || item.availability === "SLOTLESS";
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-secondary/30 bg-secondary/5 p-3" data-trip-item="BARQ_SERVICE" data-availability={item.availability}>
      <span className={`inline-flex w-fit rounded-full px-2.5 py-0.5 text-xs font-medium ${confirmed ? "bg-secondary/15 text-secondary-700" : "bg-foreground/5 text-foreground/75"}`}>{confirmed ? t("badgeBookable") : t("badgeCheckOnBooking")}</span>
      <Link href={`/services/${item.serviceId}`} className="text-base font-semibold text-foreground underline-offset-4 hover:underline">
        <bdi>{item.name}</bdi>
      </Link>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-foreground/80">
        {item.durationMinutes !== null && <span>{t("durationLabel", { duration: duration(item.durationMinutes) })}</span>}
        <span>{item.estimatedCost ? t("estimatedCost", { range: money(item.estimatedCost) }) : t("costUnknown")}</span>
      </p>
      {check && check.state !== "checking" && (
        <p role="status" className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
          {check.state === "PRICE_CHANGED" ? (check.cost ? t("checkPriceChanged", { range: money(check.cost) }) : t("costUnknown")) : check.state === "NO_SLOT_ON_DATE" ? t("checkNoSlot") : check.state === "NO_LONGER_AVAILABLE" ? t("checkUnavailable") : t("errorRetryable")}{" "}
          {check.state !== "NO_LONGER_AVAILABLE" && (
            <Link href={`/services/${item.serviceId}`} className="font-semibold text-primary underline underline-offset-4">
              {t("checkContinueAnyway")}
            </Link>
          )}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={props.onBook} disabled={check?.state === "checking" || check?.state === "NO_LONGER_AVAILABLE"} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
          {check?.state === "checking" ? t("checking") : t("continueToBooking")}
        </button>
        {plan.alternatives.length > 0 && (
          <label className="flex items-center gap-1.5 text-sm text-foreground">
            <span className="sr-only">{t("replaceWith")}</span>
            <select defaultValue="" onChange={(e) => e.target.value && props.onReplace(e.target.value)} className={SELECT} aria-label={t("replaceWith")}>
              <option value="">{t("replace")}</option>
              {plan.alternatives.map((a) => (
                <option key={a.serviceId} value={a.serviceId}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {plan.days.length > 1 && (
          <select defaultValue="" onChange={(e) => e.target.value && props.onMove(Number(e.target.value))} className={SELECT} aria-label={t("moveTo")}>
            <option value="">{t("moveTo")}</option>
            {plan.days
              .filter((d) => d.dayNumber !== day.dayNumber)
              .map((d) => (
                <option key={d.dayNumber} value={d.dayNumber}>
                  {t("dayTitle", { number: d.dayNumber })}
                </option>
              ))}
          </select>
        )}
        <button type="button" onClick={props.onRemove} className={SMALL} aria-label={`${t("remove")}: ${item.name}`}>
          <Trash2 size={16} aria-hidden /> {t("remove")}
        </button>
      </div>
    </div>
  );
}
