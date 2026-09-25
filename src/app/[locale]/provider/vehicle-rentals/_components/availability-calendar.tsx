"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, CalendarDays, CircleCheck, Ban, CalendarRange, X } from "lucide-react";
import { clsx } from "@/components/ui/clsx";
import { Dialog } from "@/components/ui/dialog";
import { useRouter } from "@/i18n/navigation";
import { formatMoney } from "@/lib/i18n/format-money";
import {
  dateKeysInInclusiveRange,
  isConfigurableKey,
  monthDayKeys,
  toggleKey,
  deriveRentalCalendarCell,
} from "@/lib/offerings/rental/provider/calendar-selection";
import { rentalActionMessageKey } from "@/lib/offerings/rental/provider/rental-action-result";
import type { ProviderRentalOfferingDay } from "@/lib/offerings/rental/provider/provider-rental-offering-dto";
import { openRentalDaysAction, blockRentalDaysAction, setRentalDayOverrideAction } from "../actions";

// Phase 3C Slice C2d-R1 Checkpoint B — the interactive PROVIDER CONFIGURATION calendar (NOT the
// customer reservation-aware availability calendar — that stays C2c). Selection is UI-only until the
// provider confirms an action; every mutation goes through a Server Action → the C2b-R domain
// authority, then the authoritative data is re-read via router.refresh() (no stale optimistic state).
// Prices are the authoritative base/override strings from the read model — never computed here. Oman
// date keys via the pure calendar-selection helpers (never browser-local Date parsing).

type PendingKind = "open" | "reopen" | "block" | "override" | "clearOverride";
type CalendarStatus = { kind: "idle" } | { kind: "ok" } | { kind: "error"; code: string };

export function AvailabilityCalendar({
  offeringId,
  baseDailyAmount,
  currency,
  configuredDays,
  todayKey,
  windowDays,
  locale,
  readOnly,
}: {
  offeringId: string;
  baseDailyAmount: string;
  currency: string;
  configuredDays: ProviderRentalOfferingDay[];
  todayKey: string;
  windowDays: number;
  locale: string;
  readOnly: boolean;
}) {
  const t = useTranslations("provider");
  const tt = t as unknown as (key: string) => string;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const info = useMemo(() => {
    const map = new Map<string, ProviderRentalOfferingDay>();
    for (const d of configuredDays) map.set(d.dateKey, d);
    return map;
  }, [configuredDays]);
  const [ty, tm] = todayKey.split("-").map(Number) as [number, number, number];
  const [view, setView] = useState<{ y: number; m0: number }>({ y: ty, m0: tm - 1 });
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [rangeMode, setRangeMode] = useState(false);
  const [rangeAnchor, setRangeAnchor] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingKind | null>(null);
  const [overrideAmount, setOverrideAmount] = useState("");
  const [status, setStatus] = useState<CalendarStatus>({ kind: "idle" });

  const dtf = useMemo(
    () => ({
      monthTitle: new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }),
      weekday: new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" }),
      dayNum: new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" }),
      full: new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }),
    }),
    [locale],
  );
  const weekdayHeaders = useMemo(
    () => Array.from({ length: 7 }, (_, i) => dtf.weekday.format(Date.UTC(2023, 0, 1 + i))),
    [dtf],
  );

  const firstWeekday = new Date(Date.UTC(view.y, view.m0, 1)).getUTCDay();
  const monthKeys = monthDayKeys(view.y, view.m0);
  const viewMonthPrefix = `${view.y}-${String(view.m0 + 1).padStart(2, "0")}`;
  const canPrev = viewMonthPrefix > todayKey.slice(0, 7);

  function shiftMonth(delta: number) {
    setView((v) => {
      const d = new Date(Date.UTC(v.y, v.m0 + delta, 1));
      return { y: d.getUTCFullYear(), m0: d.getUTCMonth() };
    });
  }

  function onCellClick(key: string) {
    if (readOnly || !isConfigurableKey(key, todayKey, windowDays)) return;
    if (rangeMode) {
      if (rangeAnchor === null) {
        setRangeAnchor(key);
        setSelection((s) => toggleKey(s, key));
        return;
      }
      const range = dateKeysInInclusiveRange(rangeAnchor, key).filter((k) => isConfigurableKey(k, todayKey, windowDays));
      setSelection((s) => {
        const next = new Set(s);
        for (const k of range) next.add(k);
        return next;
      });
      setRangeAnchor(null);
      return;
    }
    setSelection((s) => toggleKey(s, key));
  }

  function selectVisible() {
    const eligible = monthKeys.filter((k) => isConfigurableKey(k, todayKey, windowDays));
    setSelection((s) => {
      const next = new Set(s);
      for (const k of eligible) next.add(k);
      return next;
    });
  }
  function clearSelection() {
    setSelection(new Set());
    setRangeAnchor(null);
  }

  const selectedKeys = useMemo(() => [...selection].sort(), [selection]);

  function runAction(kind: PendingKind) {
    const dateKeys = selectedKeys;
    if (dateKeys.length === 0) return;
    startTransition(async () => {
      let result: { ok: true } | { ok: false; code: string };
      if (kind === "open" || kind === "reopen") {
        result = await openRentalDaysAction({ offeringId, dateKeys, reopenBlocked: kind === "reopen" });
      } else if (kind === "block") {
        result = await blockRentalDaysAction({ offeringId, dateKeys });
      } else if (kind === "override") {
        result = await setRentalDayOverrideAction({ offeringId, dateKey: dateKeys[0]!, amount: overrideAmount.trim() });
      } else {
        result = await setRentalDayOverrideAction({ offeringId, dateKey: dateKeys[0]!, amount: null });
      }
      setPending(null);
      if (result.ok) {
        setStatus({ kind: "ok" });
        setOverrideAmount("");
        clearSelection();
        router.refresh();
      } else {
        setStatus({ kind: "error", code: result.code });
      }
    });
  }

  const cellBase = "flex min-h-[52px] w-full flex-col items-center justify-center gap-0.5 rounded-lg p-1 text-xs touch-manipulation [-webkit-tap-highlight-color:transparent]";
  const range = selectedKeys.length > 0 ? `${selectedKeys[0]}${selectedKeys.length > 1 ? ` … ${selectedKeys[selectedKeys.length - 1]}` : ""}` : "";
  const confirmKey: Record<PendingKind, string> = {
    open: "rentalCalConfirmOpen", reopen: "rentalCalConfirmReopen", block: "rentalCalConfirmBlock",
    override: "rentalCalConfirmSetOverride", clearOverride: "rentalCalConfirmClearOverride",
  };

  return (
    <section aria-labelledby="rental-calendar-heading" className="flex flex-col gap-3">
      <h2 id="rental-calendar-heading" className="flex items-center gap-2 text-sm font-medium text-foreground/80">
        <CalendarDays size={16} strokeWidth={1.75} aria-hidden />
        {t("rentalCalendarHeading")}
      </h2>

      {/* Legend — state conveyed by text + icon, never color alone. */}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/60">
        <span className="inline-flex items-center gap-1"><CircleCheck size={13} className="text-success" aria-hidden />{t("rentalDayStateOpen")}</span>
        <span className="inline-flex items-center gap-1"><Ban size={13} className="text-foreground/50" aria-hidden />{t("rentalDayStateBlocked")}</span>
        <span className="inline-flex items-center gap-1"><span aria-hidden className="inline-block h-3 w-3 rounded border border-dashed border-border" />{t("rentalDayStateNotConfigured")}</span>
      </p>

      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <button type="button" onClick={() => shiftMonth(-1)} disabled={!canPrev} aria-label={t("rentalCalPrevMonth")}
            className="rounded-full p-2 text-foreground/70 transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-foreground/5 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <ChevronRight size={18} strokeWidth={1.75} className="rtl:hidden" aria-hidden />
            <ChevronLeft size={18} strokeWidth={1.75} className="hidden rtl:block" aria-hidden />
          </button>
          <span aria-live="polite" className="text-sm font-semibold text-foreground">
            {dtf.monthTitle.format(new Date(Date.UTC(view.y, view.m0, 1)))}
          </span>
          <button type="button" onClick={() => shiftMonth(1)} aria-label={t("rentalCalNextMonth")}
            className="rounded-full p-2 text-foreground/70 transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-foreground/5 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <ChevronLeft size={18} strokeWidth={1.75} className="rtl:hidden" aria-hidden />
            <ChevronRight size={18} strokeWidth={1.75} className="hidden rtl:block" aria-hidden />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {weekdayHeaders.map((w, i) => (
            <div key={i} className="flex h-7 items-center justify-center text-xs font-medium text-foreground/60">{w}</div>
          ))}
          {Array.from({ length: firstWeekday }, (_, i) => <div key={`b-${i}`} aria-hidden />)}
          {monthKeys.map((key) => {
            const utc = new Date(Date.UTC(view.y, view.m0, Number(key.slice(-2))));
            const cell = deriveRentalCalendarCell(key, { day: info.get(key), baseDailyAmount, todayKey, windowDays, selected: selection.has(key) });
            const isToday = key === todayKey;
            const stateText = cell.state === "OPEN" ? t("rentalDayStateOpen") : cell.state === "BLOCKED" ? t("rentalDayStateBlocked") : t("rentalDayStateNotConfigured");
            const isOverride = cell.priceSource === "OVERRIDE" && cell.state !== "NONE";

            if (!cell.configurable) {
              return (
                <div key={key} className={clsx(cellBase, "text-foreground/30", cell.past && "line-through", isToday && "ring-1 ring-inset ring-primary/40")} aria-hidden>
                  <span>{dtf.dayNum.format(utc)}</span>
                </div>
              );
            }
            return (
              <button key={key} type="button" onClick={() => onCellClick(key)} aria-pressed={cell.selected} disabled={readOnly || isPending}
                aria-label={`${dtf.full.format(utc)} — ${stateText} — ${formatMoney(cell.priceAmount, currency, locale)}`}
                className={clsx(
                  cellBase, "font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  cell.selected ? "bg-primary text-primary-foreground ring-2 ring-primary" : clsx(
                    "border bg-card text-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:border-primary/40",
                    cell.state === "OPEN" ? "border-success/40" : cell.state === "BLOCKED" ? "border-border bg-foreground/5" : "border-dashed border-border",
                    isToday && "ring-1 ring-inset ring-primary/40",
                  ),
                  readOnly && "cursor-default",
                )}>
                <span className="flex items-center gap-0.5">
                  {cell.state === "OPEN" && <CircleCheck size={11} strokeWidth={2} aria-hidden className={cell.selected ? "" : "text-success"} />}
                  {cell.state === "BLOCKED" && <Ban size={11} strokeWidth={2} aria-hidden />}
                  {dtf.dayNum.format(utc)}
                </span>
                <span className={clsx("tabular-nums", cell.selected ? "text-primary-foreground/90" : "text-foreground/60")}>
                  {formatMoney(cell.priceAmount, currency, locale)}
                </span>
                {isOverride && <span className={clsx("text-[10px]", cell.selected ? "text-primary-foreground/90" : "text-primary")}>{t("rentalOverrideBadge")}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {!readOnly && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => { setRangeMode((r) => !r); setRangeAnchor(null); }} aria-pressed={rangeMode}
              className={clsx("inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                rangeMode ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/70")}>
              <CalendarRange size={15} strokeWidth={1.75} aria-hidden />{t("rentalCalRangeMode")}
            </button>
            <button type="button" onClick={selectVisible}
              className="inline-flex min-h-11 items-center rounded-full border border-border px-4 py-2 text-sm text-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {t("rentalCalSelectVisible")}
            </button>
            <button type="button" onClick={clearSelection} disabled={selection.size === 0}
              className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border px-4 py-2 text-sm text-foreground/70 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              <X size={14} strokeWidth={2} aria-hidden />{t("rentalCalClearSelection")}
            </button>
            <span aria-live="polite" className="text-sm text-foreground/70">{t("rentalCalSelectedCount", { count: selection.size })}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            <ActionButton disabled={selection.size === 0 || isPending} onClick={() => setPending("open")} label={t("rentalCalOpen")} />
            <ActionButton disabled={selection.size === 0 || isPending} onClick={() => setPending("reopen")} label={t("rentalCalReopen")} />
            <ActionButton disabled={selection.size === 0 || isPending} onClick={() => setPending("block")} label={t("rentalCalBlock")} variant="danger" />
            <ActionButton disabled={selection.size !== 1 || isPending} onClick={() => setPending("override")} label={t("rentalCalSetOverride")} />
            <ActionButton disabled={selection.size !== 1 || isPending} onClick={() => setPending("clearOverride")} label={t("rentalCalClearOverride")} />
          </div>

          {status.kind === "ok" && <p role="status" className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{t("rentalCalSuccess")}</p>}
          {status.kind === "error" && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{tt(rentalActionMessageKey(status.code as never))}</p>}
        </>
      )}

      <Dialog
        open={pending !== null}
        onClose={() => { if (!isPending) setPending(null); }}
        title={t("rentalCalConfirmTitle")}
        description={pending ? tt(confirmKey[pending]).replace("{count}", String(selection.size)).replace("{range}", range) : ""}
      >
        <div className="flex flex-col gap-4">
          {pending === "override" && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-foreground/70">{t("rentalCalOverrideAmount")} ({currency})</span>
              <input inputMode="decimal" value={overrideAmount} onChange={(e) => setOverrideAmount(e.target.value)}
                className="min-h-11 rounded-lg border border-border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" />
            </label>
          )}
          {status.kind === "error" && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{tt(rentalActionMessageKey(status.code as never))}</p>}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setPending(null)} disabled={isPending}
              className="min-h-11 rounded-full border border-border px-5 py-2 text-sm text-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {t("rentalCancel")}
            </button>
            <button type="button" onClick={() => pending && runAction(pending)} disabled={isPending || (pending === "override" && overrideAmount.trim() === "")}
              className={clsx("min-h-11 rounded-full px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2",
                pending === "block" ? "bg-danger focus-visible:ring-danger/40" : "bg-primary focus-visible:ring-primary/40")}>
              {t("rentalConfirm")}
            </button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}

function ActionButton({ label, onClick, disabled, variant }: { label: string; onClick: () => void; disabled: boolean; variant?: "danger" }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={clsx("inline-flex min-h-11 items-center rounded-full px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2",
        variant === "danger" ? "bg-danger focus-visible:ring-danger/40" : "bg-primary focus-visible:ring-primary/40")}>
      {label}
    </button>
  );
}
