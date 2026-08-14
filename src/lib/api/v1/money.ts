// API v1 money serialization — Gate 1 (Public API Foundation).
//
// MoneyDTO ALWAYS carries `amount` as a DECIMAL STRING (never a float/double),
// per the Gate-1 contract. BARQ stores money as Prisma Decimal(12,2)
// (Price.amount, Booking.priceSnapshotAmount); the existing public read
// functions collapse it to a display string "<amount> <currency>"
// (get-services.ts / get-service-detail.ts). This module reshapes that existing
// output into a stable structured MoneyDTO WITHOUT touching any DB/domain money
// semantics and WITHOUT ever going through a floating-point number.

export interface MoneyDTO {
  /** Decimal amount as a string with exactly 2 fractional digits, e.g. "25.00". Never a float. */
  amount: string;
  /** Currency code as stored on the Price row, e.g. "OMR". Not localized. */
  currency: string;
}

/**
 * Normalize a decimal string to exactly two fractional digits using pure string
 * operations — never Number/parseFloat, so no precision is ever lost. Inputs
 * originate from Prisma Decimal(12,2), so at most two fractional digits exist;
 * this pads "25" → "25.00" and "25.5" → "25.50" for a stable wire contract.
 */
export function normalizeDecimalString(raw: string): string {
  const trimmed = raw.trim();
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;

  const dotIndex = unsigned.indexOf(".");
  const intPartRaw = dotIndex === -1 ? unsigned : unsigned.slice(0, dotIndex);
  const fracPartRaw = dotIndex === -1 ? "" : unsigned.slice(dotIndex + 1);
  const intPart = intPartRaw.length > 0 ? intPartRaw : "0";
  const fracPart = (fracPartRaw + "00").slice(0, 2);

  return `${negative ? "-" : ""}${intPart}.${fracPart}`;
}

/** Build a MoneyDTO from a raw decimal string + currency (e.g. the activePrices path). */
export function toMoneyDTO(amount: string, currency: string): MoneyDTO {
  return { amount: normalizeDecimalString(amount), currency };
}

/**
 * Parse the domain "<amount> <currency>" price string (as produced by
 * get-services.ts / get-service-detail.ts) into a MoneyDTO, or null when the
 * source is null/malformed. Splits on the LAST space (currency codes contain no
 * spaces), validates the amount is numeric, and normalizes it to a 2-dp string.
 */
export function parseMoneyString(raw: string | null | undefined): MoneyDTO | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  const lastSpace = trimmed.lastIndexOf(" ");
  if (lastSpace <= 0) return null;

  const amountPart = trimmed.slice(0, lastSpace).trim();
  const currency = trimmed.slice(lastSpace + 1).trim();
  if (amountPart.length === 0 || currency.length === 0) return null;
  if (!/^-?\d+(\.\d+)?$/.test(amountPart)) return null;

  return { amount: normalizeDecimalString(amountPart), currency };
}
