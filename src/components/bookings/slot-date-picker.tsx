"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { clsx } from "@/components/ui/clsx";

// Phase 3A — customer date-selection experience (Gate 2, no-schema slice).
//
// A premium, mobile-first SINGLE-DATE calendar over the service's REAL Availability
// slots. It changes NOTHING on the server: the day-grid only narrows which real slots are
// shown, and the chosen slot is submitted through the SAME `availabilityId` radio the plain
// list used — so createBooking's slot/capacity/idempotency authority is untouched. Days are
// grouped by the slot's Oman-local calendar date (computed server-side via omanDateKey);
// this component does pure Y-M-D math on those keys, no timezone logic in the browser.
//
// Deliberately single-date only: continuous ranges, separate non-consecutive dates and
// per-day pricing are NOT modeled by the current booking/pricing engine (PER_DAY/PER_HOUR
// are non-bookable), so none of that is faked here — it awaits the separate schema gate.

export type PickerSlot = { id: string; dayKey: string; timeLabel: string; remainingSeats: number };

type Labels = {
  legend: string;
  chooseDatePrompt: string;
  timesHeading: string;
  remainingSeats: string;
  prevMonth: string;
  nextMonth: string;
  todaySuffix: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;

export function SlotDatePicker({
  slots,
  todayKey,
  locale,
  labels,
}: {
  slots: PickerSlot[];
  todayKey: string;
  locale: string;
  labels: Labels;
}) {
  const byDay = useMemo(() => {
    const map = new Map<string, PickerSlot[]>();
    for (const s of slots) {
      const list = map.get(s.dayKey) ?? [];
      list.push(s);
      map.set(s.dayKey, list);
    }
    return map;
  }, [slots]);

  const availableKeys = useMemo(() => [...byDay.keys()].sort(), [byDay]);
  const firstKey = availableKeys[0] ?? todayKey;
  const lastKey = availableKeys[availableKeys.length - 1] ?? todayKey;

  const [fy, fm] = firstKey.split("-").map(Number) as [number, number, number];
  const [view, setView] = useState<{ y: number; m0: number }>({ y: fy, m0: fm - 1 });
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(availableKeys.length === 1 ? firstKey : null);

  const dtf = useMemo(() => ({
    dayLabel: new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }),
    monthTitle: new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }),
    weekday: new Intl.DateTimeFormat(locale, { weekday: "narrow" }),
    dayNum: new Intl.DateTimeFormat(locale, { day: "numeric" }),
  }), [locale]);

  // Weekday headers, Sunday-first (matches the plain grid; labels come from Intl for the locale).
  const weekdayHeaders = useMemo(
    () => Array.from({ length: 7 }, (_, i) => dtf.weekday.format(new Date(2023, 0, 1 + i))),
    [dtf]
  );

  const daysInMonth = new Date(view.y, view.m0 + 1, 0).getDate();
  const firstWeekday = new Date(view.y, view.m0, 1).getDay(); // 0=Sun

  const viewKeyStart = keyOf(view.y, view.m0, 1);
  const canPrev = viewKeyStart > todayKey.slice(0, 7) + "-01"; // strictly after the current month
  const lastMonthStart = lastKey.slice(0, 7) + "-01";
  const canNext = viewKeyStart < lastMonthStart;

  function shiftMonth(delta: number) {
    setView((v) => {
      const d = new Date(v.y, v.m0 + delta, 1);
      return { y: d.getFullYear(), m0: d.getMonth() };
    });
  }

  const selectedSlots = selectedDayKey ? byDay.get(selectedDayKey) ?? [] : [];

  const cellBase =
    "flex h-10 w-full items-center justify-center rounded-lg text-sm touch-manipulation [-webkit-tap-highlight-color:transparent]";

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="flex items-center gap-2 text-sm font-medium text-foreground/80">
        <Calendar size={16} strokeWidth={1.75} aria-hidden />
        {labels.legend}
      </legend>

      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            disabled={!canPrev}
            aria-label={labels.prevMonth}
            className="rounded-full p-2 text-foreground/70 transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-foreground/5 disabled:opacity-30"
          >
            <ChevronRight size={18} strokeWidth={1.75} className="rtl:hidden" aria-hidden />
            <ChevronLeft size={18} strokeWidth={1.75} className="hidden rtl:block" aria-hidden />
          </button>
          <span aria-live="polite" className="text-sm font-semibold text-foreground">
            {dtf.monthTitle.format(new Date(view.y, view.m0, 1))}
          </span>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            disabled={!canNext}
            aria-label={labels.nextMonth}
            className="rounded-full p-2 text-foreground/70 transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-foreground/5 disabled:opacity-30"
          >
            <ChevronLeft size={18} strokeWidth={1.75} className="rtl:hidden" aria-hidden />
            <ChevronRight size={18} strokeWidth={1.75} className="hidden rtl:block" aria-hidden />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {weekdayHeaders.map((w, i) => (
            <div key={i} className="flex h-7 items-center justify-center text-xs font-medium text-foreground/60">
              {w}
            </div>
          ))}
          {Array.from({ length: firstWeekday }, (_, i) => (
            <div key={`blank-${i}`} aria-hidden />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            const dayKey = keyOf(view.y, view.m0, day);
            const hasSlots = byDay.has(dayKey);
            const isToday = dayKey === todayKey;
            const isSelected = dayKey === selectedDayKey;
            const cellDate = new Date(view.y, view.m0, day);
            const numeral = dtf.dayNum.format(cellDate);

            if (!hasSlots) {
              // Unavailable / past — muted, non-interactive (never a tap target).
              return (
                <div key={dayKey} className={clsx(cellBase, "text-foreground/40", isToday && "ring-1 ring-inset ring-primary/40")} aria-hidden>
                  {numeral}
                </div>
              );
            }
            return (
              <button
                key={dayKey}
                type="button"
                onClick={() => setSelectedDayKey(dayKey)}
                aria-pressed={isSelected}
                aria-label={`${dtf.dayLabel.format(cellDate)}${isToday ? ` — ${labels.todaySuffix}` : ""}`}
                className={clsx(
                  cellBase,
                  "font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  isSelected
                    ? "bg-primary text-primary-foreground"
                    : clsx(
                        "border border-border bg-card text-foreground",
                        "[@media(hover:hover)_and_(pointer:fine)]:hover:border-primary/40 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-accent/10",
                        isToday && "ring-1 ring-inset ring-primary/40"
                      )
                )}
              >
                {numeral}
              </button>
            );
          })}
        </div>
      </div>

      {selectedDayKey === null ? (
        <p className="text-sm text-foreground/60">{labels.chooseDatePrompt}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-foreground/60">{labels.timesHeading}</span>
          {selectedSlots.map((slot, i) => (
            <label
              key={slot.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent/20"
            >
              <span className="flex items-center gap-3">
                <input type="radio" name="availabilityId" value={slot.id} required defaultChecked={i === 0} className="accent-primary" />
                {slot.timeLabel}
              </span>
              <span className="text-xs text-foreground/70">
                {slot.remainingSeats} {labels.remainingSeats}
              </span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
