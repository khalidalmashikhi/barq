import { z } from "zod";
import { isVehicleFourByFourCapable } from "@/lib/vehicles/capability";

// BOOKING-VEHICLE-SNAPSHOT — the ONE builder + typed parser for a booking's historical,
// customer-safe assigned-vehicle snapshot. Pure (no I/O, no server-only) so it is unit
// testable and usable on either side of the boundary.
//
// The snapshot is an ALLOWLIST — built field-by-field, never a spread of the vehicle row —
// so a private column can never leak in by accident. `isFourByFour` is DERIVED from the
// trusted admin-confirmed flag ONLY (fourByFourVerified === true): a provider claim, a
// FOUR_BY_FOUR vehicleType code, or "SUV" never make it true. `passengerCapacity` keeps
// its locked meaning (guest passengers, excluding driver + operating guide).

export type BookingVehicleSnapshot = {
  make: string | null;
  model: string | null;
  modelYear: number | null;
  color: string | null;
  /** GUEST/customer passenger capacity (excludes driver + operating guide). */
  passengerCapacity: number | null;
  vehicleType: string | null;
  /** TRUSTED, admin-confirmed 4x4 capability (derived; never the provider claim/type). */
  isFourByFour: boolean;
};

/** The authoritative vehicle facts the snapshot is derived from (a subset of the pool row). */
export type BookingVehicleSnapshotSource = {
  make: string | null;
  model: string | null;
  modelYear: number | null;
  color: string | null;
  passengerCapacity: number | null;
  vehicleType: string | null;
  /** Raw trusted admin flag — consumed here ONLY to derive isFourByFour; never stored raw. */
  fourByFourVerified: boolean | null;
};

/**
 * Build the customer-safe snapshot from the authoritative vehicle that survived the
 * in-transaction eligibility re-check. Never reads registration/documents/verification —
 * `source` only carries the allowlisted facts plus the raw trusted flag it derives from.
 */
export function buildBookingVehicleSnapshot(source: BookingVehicleSnapshotSource): BookingVehicleSnapshot {
  return {
    make: source.make,
    model: source.model,
    modelYear: source.modelYear,
    color: source.color,
    passengerCapacity: source.passengerCapacity,
    vehicleType: source.vehicleType,
    // Trusted-only derivation — the raw flag is consumed, never stored.
    isFourByFour: isVehicleFourByFourCapable({ fourByFourVerified: source.fourByFourVerified }),
  };
}

// `.strict()` — any unexpected key (a private field that somehow reached storage) makes the
// parse fail rather than pass the value through, so a stored snapshot can never surface
// more than the allowlist. Used by the next gate to read the JSON column defensively.
const bookingVehicleSnapshotSchema = z
  .object({
    make: z.string().nullable(),
    model: z.string().nullable(),
    modelYear: z.number().int().nullable(),
    color: z.string().nullable(),
    passengerCapacity: z.number().int().nullable(),
    vehicleType: z.string().nullable(),
    isFourByFour: z.boolean(),
  })
  .strict();

/**
 * Parse a stored `Booking.vehicleSnapshot` JSON value into the typed snapshot, or null when
 * it is absent/legacy/malformed. Never throws; never trusts the raw column shape.
 */
export function parseBookingVehicleSnapshot(input: unknown): BookingVehicleSnapshot | null {
  if (input == null) return null;
  const parsed = bookingVehicleSnapshotSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
