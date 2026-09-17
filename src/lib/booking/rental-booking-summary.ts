import "server-only";

// Phase 3C Slice C3/E2 — the STRICT, fail-closed parser that projects a Booking.rentalSnapshot JSON
// into a CUSTOMER-SAFE summary for read models (customer / provider / admin list + detail DTOs). It
// is the single place that decides what of the rental snapshot is presentable, mirroring
// parseBookingVehicleSnapshot: on any absent/legacy/malformed value it returns null (never throws,
// never leaks raw JSON). It deliberately EXCLUDES internal identifiers (holdGroupId, quoteFingerprint)
// — a read surface never needs them. The authoritative party size is `passengerCount` (NEVER the
// billing-neutral Booking.seats=1) and the authoritative money is the booking's TOTALIZED total
// (`bookingMoney`); this summary carries the day/price breakdown behind that total.

export type RentalBookingSummary = {
  offeringId: string;
  vehicleId: string;
  vehicle: {
    make: string | null;
    model: string | null;
    modelYear: number | null;
    color: string | null;
    vehicleType: string | null;
    bookablePassengerCapacity: number;
  };
  /** The customer party size — capacity-only, the authoritative "how many people". NEVER seats. */
  passengerCount: number;
  /** The number of chargeable Oman days ( = dateKeys.length). NEVER a price multiplier. */
  chargeableDays: number;
  dateKeys: string[];
  perDate: { dateKey: string; amount: string; currency: string; source: string }[];
  total: string;
  currency: string;
  pricingUnit: string;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const posInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

/**
 * Parse a Booking.rentalSnapshot into a customer-safe summary, or null if absent/legacy/malformed.
 * Fail-closed: any structural surprise yields null rather than a partial/leaky object.
 */
export function parseRentalBookingSummary(raw: unknown): RentalBookingSummary | null {
  if (!isObj(raw)) return null;
  const v = raw.vehicle;
  if (!isObj(v)) return null;
  if (!str(raw.rentalOfferingId) || !str(raw.vehicleId) || !str(raw.total) || !str(raw.currency) || !str(raw.pricingUnit)) return null;
  if (!posInt(raw.passengerCount) || !posInt(raw.chargeableDays) || !posInt(v.bookablePassengerCapacity)) return null;
  if (!Array.isArray(raw.dateKeys) || !raw.dateKeys.every(str)) return null;
  if (!Array.isArray(raw.perDate)) return null;

  const perDate: RentalBookingSummary["perDate"] = [];
  for (const d of raw.perDate) {
    if (!isObj(d) || !str(d.dateKey) || !str(d.amount) || !str(d.currency) || !str(d.source)) return null;
    perDate.push({ dateKey: d.dateKey, amount: d.amount, currency: d.currency, source: d.source });
  }

  return {
    offeringId: raw.rentalOfferingId,
    vehicleId: raw.vehicleId,
    vehicle: {
      make: str(v.make) ? v.make : null,
      model: str(v.model) ? v.model : null,
      modelYear: typeof v.modelYear === "number" ? v.modelYear : null,
      color: str(v.color) ? v.color : null,
      vehicleType: str(v.vehicleType) ? v.vehicleType : null,
      bookablePassengerCapacity: v.bookablePassengerCapacity,
    },
    passengerCount: raw.passengerCount,
    chargeableDays: raw.chargeableDays,
    dateKeys: raw.dateKeys as string[],
    perDate,
    total: raw.total,
    currency: raw.currency,
    pricingUnit: raw.pricingUnit,
  };
}
