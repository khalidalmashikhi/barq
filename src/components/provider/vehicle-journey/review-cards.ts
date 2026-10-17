import { CONFIRMATION_FIELD_KEYS, type ConfirmationFieldKey } from "@/lib/vehicles/registration-review/field-model";
import { isBlank, isFlaggedForReview, type ReviewFieldStatus } from "@/lib/vehicles/registration-review/review-field-state";

// 2026-10-17 — the card-based vehicle review. PURE presentation contract: which confirmation field
// appears in which card, and the readiness summary of the final card. It never decides what is
// public (that stays the field model's group + the server DTOs) and never decides whether the
// vehicle may be created (that stays the shared parseConfirmation validator the server runs).
//
//   CUSTOMER  — "Information shown to customers": make, commercial model, model year, colour
//               (+ the vehicle type the provider chooses, and a read-only echo of the bookable
//               capacity, which is EDITED in the capacity card)
//   CAPACITY  — "Capacity and operation": licensed capacity (registration), registered seats (only
//               when the document or the provider gave one), bookable capacity (provider-entered,
//               the only one shown to customers), the 4x4 declaration
//   PRIVATE   — "Private registration details" (collapsed): every other registration field —
//               plate, VIN, engine number, dates, technical data; sensitive values stay masked
//
// Invariants (test-enforced): the three cards partition every confirmation field exactly once; the
// customer card holds only CUSTOMER-group fields; the private card holds only PRIVATE-group fields
// and every sensitive identifier; nothing private is ever placed in the customer card.

export type ReviewCard = "CUSTOMER" | "CAPACITY" | "PRIVATE";

export const CUSTOMER_CARD_KEYS = ["make", "model", "modelYear", "color"] as const satisfies readonly ConfirmationFieldKey[];
export const CAPACITY_CARD_KEYS = ["licensedPassengerCapacity", "registeredSeats", "bookablePassengerCapacity"] as const satisfies readonly ConfirmationFieldKey[];
export const PRIVATE_CARD_KEYS: readonly ConfirmationFieldKey[] = CONFIRMATION_FIELD_KEYS.filter(
  (k) => !(CUSTOMER_CARD_KEYS as readonly string[]).includes(k) && !(CAPACITY_CARD_KEYS as readonly string[]).includes(k),
);

/** Within the capacity card, the one value customers see (once the vehicle is approved). */
export const CAPACITY_SHOWN_TO_CUSTOMERS: ConfirmationFieldKey = "bookablePassengerCapacity";

export function reviewCardOf(key: ConfirmationFieldKey): ReviewCard {
  if ((CUSTOMER_CARD_KEYS as readonly string[]).includes(key)) return "CUSTOMER";
  if ((CAPACITY_CARD_KEYS as readonly string[]).includes(key)) return "CAPACITY";
  return "PRIVATE";
}

type CardField = { key: ConfirmationFieldKey; extractedValue: string | number | null; confirmedValue: string | number | null };

/** Registered seats are shown only when the document printed them or a value exists — they are
 *  optional and never derived from the passenger count. Every other field is always shown. */
export function isCardFieldShown(f: CardField, value: string | undefined): boolean {
  if (f.key !== "registeredSeats") return true;
  return f.extractedValue !== null || f.confirmedValue !== null || !isBlank(value);
}

type ReadinessField = CardField & { required: boolean; needsReview: boolean };

export type ReviewReadiness = {
  /** Required items (fields + vehicle type + declaration) that are filled / ticked. */
  completed: number;
  total: number;
  /** Required items still missing, in display order (field keys, "vehicleType", "declaration"). */
  missing: (ConfirmationFieldKey | "vehicleType" | "declaration")[];
  /** Fields still flagged "check this" (same rule as the field row's chip). */
  needsReview: ConfirmationFieldKey[];
};

/** The final card's summary. Informative only: "Create" stays governed by the real validator. */
export function reviewReadiness<T extends ReadinessField>(input: {
  fields: readonly T[];
  values: Readonly<Record<string, string>>;
  statusOf: (f: T) => ReviewFieldStatus;
  vehicleType: string;
  declaration: boolean;
}): ReviewReadiness {
  const order = [...CUSTOMER_CARD_KEYS, ...CAPACITY_CARD_KEYS, ...PRIVATE_CARD_KEYS] as ConfirmationFieldKey[];
  const byKey = new Map(input.fields.map((f) => [f.key, f]));
  const ordered = order.map((k) => byKey.get(k)).filter((f): f is T => f !== undefined);
  const missing: ReviewReadiness["missing"] = [];
  let completed = 0;
  let total = 0;
  if (input.vehicleType === "") missing.push("vehicleType");
  else completed += 1;
  total += 1;
  for (const f of ordered) {
    if (!f.required) continue;
    total += 1;
    if (isBlank(input.values[f.key])) missing.push(f.key);
    else completed += 1;
  }
  total += 1;
  if (input.declaration) completed += 1;
  else missing.push("declaration");
  const needsReview = ordered.filter((f) => isFlaggedForReview(f, input.statusOf(f))).map((f) => f.key);
  return { completed, total, missing, needsReview };
}
