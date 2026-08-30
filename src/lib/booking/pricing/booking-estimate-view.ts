import type { Billability } from "@/lib/pricing-units/billability";
import { parseBookingQuantity } from "@/lib/booking/parse-booking-quantity";
import { previewBookingTotal, normalizeDisplayAmount } from "./preview-booking-total";

// CUSTOMER PRE-SUBMIT BOOKING TOTAL — the PURE (client-safe) resolver that turns the current
// selection (a chosen Price + the raw seats input value) into a display view for the estimate
// island. All logic lives here so the client component stays a thin observer wrapper; this is
// unit-tested exhaustively while the component's DOM wiring is verified by visual QA.
//
// Quantity is interpreted by the SAME parseBookingQuantity the server uses (§11) — so the preview
// reflects the exact server contract (absent → 1; a present empty/0/negative/fractional/non-numeric
// value → invalid, shown as "unavailable" rather than a misleading total, never silently coerced).

export type BookingEstimatePriceFacts = {
  id: string;
  amount: string;
  currency: string;
  /// SERVER-classified billability (via classifyBillability) — the safe token, NEVER the raw
  /// pricing-unit code (which must never reach a customer-facing surface). null for legacy/ungoverned.
  billability: Billability | null;
  /// The already-localized unit label (e.g. "per person"), or null. Safe to display.
  pricingUnitLabel: string | null;
};

export type BookingEstimateView =
  /// No price selected yet — prompt to choose one (never a total).
  | { state: "no-price" }
  /// The current quantity input is present but invalid — do NOT show a misleading total (§12).
  | { state: "invalid-quantity" }
  /// The selected price's unit cannot be previewed (legacy/duration/unknown) — safe "unavailable".
  | { state: "unavailable" }
  /// A concrete expected total. `showMultiplication` is true only when a real multiplication
  /// happened (a quantity-based unit with quantity > 1) — so a fixed-basis or single-unit booking
  /// shows just the total, never "× 1" or "× guests".
  | {
      state: "ready";
      currency: string;
      unitAmount: string; // normalized 2dp
      quantity: number;
      totalAmount: string; // normalized 2dp
      basisLabel: string | null;
      showMultiplication: boolean;
    };

/**
 * Resolve the estimate view from the selected price facts and the raw quantity string (the seats
 * input value, or null when the service has no seats input — a slotless booking, quantity 1).
 */
export function resolveBookingEstimate(
  price: BookingEstimatePriceFacts | null,
  quantityRaw: string | null
): BookingEstimateView {
  if (!price) return { state: "no-price" };

  const quantity = parseBookingQuantity(quantityRaw);
  if (!quantity.ok) return { state: "invalid-quantity" };

  const preview = previewBookingTotal({ unitAmount: price.amount, billability: price.billability, quantity: quantity.value });
  if (!preview.ok) return { state: "unavailable" };

  const unitAmount = normalizeDisplayAmount(price.amount);
  if (unitAmount === null) return { state: "unavailable" };

  return {
    state: "ready",
    currency: price.currency,
    unitAmount,
    quantity: quantity.value,
    totalAmount: preview.total,
    basisLabel: price.pricingUnitLabel,
    showMultiplication: preview.billableQuantity > 1,
  };
}
