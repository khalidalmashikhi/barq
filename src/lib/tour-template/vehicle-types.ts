// Smart Tour-Guide Template — guided-tour view of the canonical vehicle-type registry.
//
// The registry itself is a GENERIC PHYSICAL taxonomy and now lives in the neutral, app-owned
// `src/lib/vehicles/vehicle-type-codes.ts` (so the rental domain no longer depends, even by name,
// on guided-tour code). This module RE-EXPORTS it under the historical `TOUR_*` names purely for
// backward compatibility with existing guided-tour consumers (bootstrap, form, guiding-content,
// get-tour-template-config, smart-tour-guide-section). No behavior change: same codes, same bounds,
// same localized defaults, one source of truth. Admin may still localize/enable/reorder a label
// (TourVehicleTypeOption); a DB row whose `code` is not in the set is ignored (fail-closed).
//
// Taxonomy is NOT authorization — see the note in vehicle-type-codes.ts. A code being valid for a
// guided tour never grants standalone rental, and vice versa.

import {
  VEHICLE_TYPE_CODES,
  VEHICLE_TYPE_DEFAULTS,
  isVehicleTypeCode,
  MIN_VEHICLE_YEAR as MIN_YEAR,
  MAX_VEHICLE_YEAR as MAX_YEAR,
  MAX_VEHICLE_PASSENGER_CAPACITY as MAX_CAP,
  type VehicleTypeCode,
  type VehicleTypeDefault,
} from "@/lib/vehicles/vehicle-type-codes";

export const TOUR_VEHICLE_CODES = VEHICLE_TYPE_CODES;
export type TourVehicleCode = VehicleTypeCode;
export const isTourVehicleCode = isVehicleTypeCode;

export const MIN_VEHICLE_YEAR = MIN_YEAR;
export const MAX_VEHICLE_YEAR = MAX_YEAR;
export const MAX_VEHICLE_PASSENGER_CAPACITY = MAX_CAP;

export type TourVehicleDefault = VehicleTypeDefault;
export const TOUR_VEHICLE_DEFAULTS: readonly TourVehicleDefault[] = VEHICLE_TYPE_DEFAULTS;
