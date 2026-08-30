import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { pricingUnitLabelKey } from "@/lib/pricing-units/labels";
import { bookingMoneyRows, type BookingMoneyView } from "@/lib/booking/pricing/booking-money-view";

// BOOKING TOTAL PRESENTATION — the shared detail-page money breakdown.
//
// Renders the SAME rows the pure bookingMoneyRows() decides — so a customer, a provider, and
// (via the same helper, inline) an admin can never see a different breakdown for the same booking.
// Rows are separate label/value pairs, NOT one interpolated "amount × qty = total" string, so the
// figures stay readable in RTL (§22): Arabic and English both lay the rows out the same way, and
// the multiplication is expressed as three labelled rows, never a fragile reversed expression.
//
// HONEST BY CONSTRUCTION: a legacy booking shows a single "booking amount" row (no invented unit ×
// quantity, §4); a fixed-basis totalized booking (per booking/trip/vehicle) shows a single total
// row with its basis, never × passengers (§6–§8); only a genuine per-person total shows the real
// unit → quantity → total breakdown (§5). When the money can't be resolved it shows a safe
// "unavailable" row and NEVER the unit price dressed up as a total (§20).
//
// Hierarchy is not color-only (§23): the total row is bold as well as tinted; secondary rows are
// muted but full-size (text-sm), never sub-legible.

export async function BookingMoneyBreakdown({ money }: { money: BookingMoneyView }) {
  const t = await getServerTranslator("booking");
  const tCommon = await getServerTranslator("common");
  const rows = bookingMoneyRows(money);

  if (!rows) {
    return (
      <div className="flex items-center justify-between text-sm">
        <span className="text-foreground/50">{t("priceLabel")}</span>
        <span className="font-medium text-foreground/40">{t("bookingAmountUnavailableLabel")}</span>
      </div>
    );
  }

  return (
    <>
      {rows.map((row) => {
        if (row.kind === "unit") {
          const basisKey = pricingUnitLabelKey(row.pricingUnit);
          return (
            <div key="unit" className="flex items-center justify-between text-sm">
              <span className="text-foreground/50">
                {t("unitPriceLabel")}
                {basisKey && <span className="text-foreground/40"> · {tCommon(basisKey)}</span>}
              </span>
              <span className="font-medium text-foreground">
                {row.amount} {row.currency}
              </span>
            </div>
          );
        }
        if (row.kind === "quantity") {
          return (
            <div key="quantity" className="flex items-center justify-between text-sm">
              <span className="text-foreground/50">{t("billableQuantityLabel")}</span>
              <span className="font-medium text-foreground">{row.value}</span>
            </div>
          );
        }
        const label = row.mode === "LEGACY" ? t("bookingAmountLabel") : t("bookingTotalLabel");
        const basisKey = row.pricingUnit ? pricingUnitLabelKey(row.pricingUnit) : null;
        return (
          <div key="total" className="flex items-center justify-between text-sm">
            <span className="text-foreground/50">
              {label}
              {basisKey && <span className="text-foreground/40"> · {tCommon(basisKey)}</span>}
            </span>
            <span className="font-semibold text-primary">
              {row.amount} {row.currency}
            </span>
          </div>
        );
      })}
    </>
  );
}
