"use client";

import { useEffect, useRef, useState } from "react";
import { resolveBookingEstimate, type BookingEstimatePriceFacts } from "@/lib/booking/pricing/booking-estimate-view";

// CUSTOMER PRE-SUBMIT BOOKING TOTAL — a small client island that shows the EXPECTED booking total
// for the current selection, updating live as the price or quantity changes. It is a progressive
// enhancement and a PREVIEW only:
//   • It OWNS no inputs — the price radios and the seats field stay server-rendered, so the form
//     submits and works with JavaScript disabled. This island only OBSERVES the enclosing <form>
//     (the checked priceId radio + the seats value) and renders a summary.
//   • It is never authoritative — createBooking() re-reads the ACTIVE Price and computes the real
//     total server-side; nothing here is trusted on submit.
// All computation lives in the pure resolveBookingEstimate(); this component is just DOM wiring +
// presentation, so the surrounding page stays server-rendered.

type Labels = {
  /// "Expected total" — deliberately NOT "amount charged/paid" (payment is not active).
  title: string;
  selectPrice: string;
  invalidQuantity: string;
  unavailable: string;
};

type Props = {
  /// Server-provided display facts for every ACTIVE price (id/amount/currency/unit/label) — preview
  /// only; the amount/currency/unit are never trusted back on submit.
  prices: BookingEstimatePriceFacts[];
  labels: Labels;
};

export function BookingEstimate({ prices, labels }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [selectedPriceId, setSelectedPriceId] = useState<string | null>(null);
  // null = the form has no seats input (a slotless booking → quantity 1); a string = its live value.
  const [quantityRaw, setQuantityRaw] = useState<string | null>(null);

  useEffect(() => {
    const form = rootRef.current?.closest("form");
    if (!form) return;
    const read = () => {
      const price = form.querySelector('input[name="priceId"]:checked') as HTMLInputElement | null;
      setSelectedPriceId(price ? price.value : null);
      const seats = form.querySelector('input[name="seats"]') as HTMLInputElement | null;
      setQuantityRaw(seats ? seats.value : null);
    };
    read();
    // `input` covers typing in the seats number field; `change` covers selecting a price radio.
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    return () => {
      form.removeEventListener("input", read);
      form.removeEventListener("change", read);
    };
  }, []);

  const selectedPrice = prices.find((p) => p.id === selectedPriceId) ?? null;
  const view = resolveBookingEstimate(selectedPrice, quantityRaw);

  return (
    <div ref={rootRef} aria-live="polite" className="flex flex-col gap-1 rounded-xl border border-border bg-background/60 px-4 py-3">
      <span className="text-xs font-medium text-foreground/50">{labels.title}</span>
      {view.state === "no-price" ? (
        <span className="text-sm text-foreground/40">{labels.selectPrice}</span>
      ) : view.state === "invalid-quantity" ? (
        <span className="text-sm text-foreground/40">{labels.invalidQuantity}</span>
      ) : view.state === "unavailable" ? (
        <span className="text-sm text-foreground/40">{labels.unavailable}</span>
      ) : view.showMultiplication ? (
        // A real per-person multiplication — rendered as separate semantic pieces (never one
        // interpolated string) so the figures stay readable in RTL, and wrapping on narrow screens.
        <div className="flex flex-wrap items-baseline gap-1.5 text-sm">
          <span className="text-foreground/60">{view.unitAmount} {view.currency}</span>
          <span aria-hidden className="text-foreground/40">×</span>
          <span className="text-foreground/60">{view.quantity}</span>
          <span aria-hidden className="text-foreground/40">=</span>
          <span className="text-lg font-semibold text-primary">{view.totalAmount} {view.currency}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          <span className="text-lg font-semibold text-primary">{view.totalAmount} {view.currency}</span>
          {view.basisLabel && <span className="text-xs text-foreground/40">{view.basisLabel}</span>}
        </div>
      )}
    </div>
  );
}
