import { TOUR_PACKAGE_SEMANTICS, type TourPackageKey } from "../packages";
import type { TourVehicleCode } from "../vehicle-types";
import { GUIDING_CONTENT_VERSION, type GuidingContent, type TourDifficulty } from "../guiding-content";

// Smart Tour-Guide Template — the ONE client<->server form serialization layer
// (TOUR-2, Phase 13). PURE (no react/prisma/server-only) so it is fully unit-
// tested and shared by web create, web edit, and any future native path. It
// produces exactly the TOUR-1 guidingContent v1 shape; the server ALWAYS
// re-validates with parseGuidingContent(), so this layer is convenience, never
// the security boundary. No browser field can inject an unknown key because
// buildGuidingContentPayload only ever emits the fixed v1 keys.

export type TourVehicleFormState = {
  type: TourVehicleCode | "";
  make: string;
  model: string;
  year: string;
  passengerCapacity: string;
};

export type TourFormState = {
  packageType: TourPackageKey;
  durationMinutes: string;
  meetingPoint: string;
  pickupIncluded: boolean;
  pickupArea: string;
  hotelPickup: boolean;
  airportPickup: boolean;
  maxGuests: string;
  languages: string; // newline-separated in the UI
  itinerary: { title: string; description: string }[];
  includedItems: string; // newline-separated
  excludedItems: string; // newline-separated
  difficulty: TourDifficulty | "";
  childFriendly: boolean | null;
  privateTour: boolean | null;
  recommendedEquipment: string; // newline-separated
  refreshmentsIncluded: boolean | null;
  importantNotes: string;
  vehicle: TourVehicleFormState;
};

// --- App-owned package -> vehicle UI semantics (mirror TOUR_PACKAGE_SEMANTICS;
// the server contract is authoritative regardless). ---

export function vehicleVisibleFor(pkg: TourPackageKey): boolean {
  const s = TOUR_PACKAGE_SEMANTICS[pkg];
  return s.includesTransport || s.vehicleOptional; // GUIDE_ONLY -> false
}

export function vehicleRequiredFor(pkg: TourPackageKey): boolean {
  return TOUR_PACKAGE_SEMANTICS[pkg].includesTransport;
}

export function forcedVehicleTypeFor(pkg: TourPackageKey): TourVehicleCode | null {
  return TOUR_PACKAGE_SEMANTICS[pkg].requiresFourByFour ? "FOUR_BY_FOUR" : null;
}

const EMPTY_VEHICLE: TourVehicleFormState = { type: "", make: "", model: "", year: "", passengerCapacity: "" };

export function emptyTourFormState(defaultPackage: TourPackageKey = "GUIDE_ONLY"): TourFormState {
  return {
    packageType: defaultPackage,
    durationMinutes: "",
    meetingPoint: "",
    pickupIncluded: false,
    pickupArea: "",
    hotelPickup: false,
    airportPickup: false,
    maxGuests: "",
    languages: "",
    itinerary: [],
    includedItems: "",
    excludedItems: "",
    difficulty: "",
    childFriendly: null,
    privateTour: null,
    recommendedEquipment: "",
    refreshmentsIncluded: null,
    importantNotes: "",
    vehicle: { ...EMPTY_VEHICLE },
  };
}

// Switch package: clear the vehicle block when the new package forbids it, and
// force FOUR_BY_FOUR when the new package requires it — so the client never
// submits a stale/contradictory vehicle. (The server enforces the same rules.)
export function applyPackageChange(state: TourFormState, nextPackage: TourPackageKey): TourFormState {
  if (!vehicleVisibleFor(nextPackage)) {
    return { ...state, packageType: nextPackage, vehicle: { ...EMPTY_VEHICLE } };
  }
  const forced = forcedVehicleTypeFor(nextPackage);
  return {
    ...state,
    packageType: nextPackage,
    vehicle: forced ? { ...state.vehicle, type: forced } : state.vehicle,
  };
}

const linesToList = (value: string): string[] =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const numOrNull = (value: string): number | null => {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
};

const textOrNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

// Serialize form state to the guidingContent v1 shape (a plain JSON value). Only
// the fixed v1 keys are emitted. pickup sub-fields are cleared when pickup is not
// included; the vehicle block is emitted only when the package permits it and a
// type is chosen — otherwise null.
export function buildGuidingContentPayload(state: TourFormState): Record<string, unknown> {
  const showVehicle = vehicleVisibleFor(state.packageType) && state.vehicle.type !== "";
  const vehicle = showVehicle
    ? {
        type: state.vehicle.type,
        make: textOrNull(state.vehicle.make),
        model: textOrNull(state.vehicle.model),
        year: numOrNull(state.vehicle.year),
        passengerCapacity: numOrNull(state.vehicle.passengerCapacity),
      }
    : null;

  return {
    version: GUIDING_CONTENT_VERSION,
    packageType: state.packageType,
    durationMinutes: numOrNull(state.durationMinutes),
    meetingPoint: textOrNull(state.meetingPoint),
    pickup: {
      included: state.pickupIncluded,
      area: state.pickupIncluded ? textOrNull(state.pickupArea) : null,
      hotelPickup: state.pickupIncluded ? state.hotelPickup : false,
      airportPickup: state.pickupIncluded ? state.airportPickup : false,
    },
    maxGuests: numOrNull(state.maxGuests),
    languages: linesToList(state.languages),
    itinerary: state.itinerary
      .map((stop) => ({ title: stop.title.trim(), description: textOrNull(stop.description) }))
      .filter((stop) => stop.title.length > 0),
    includedItems: linesToList(state.includedItems),
    excludedItems: linesToList(state.excludedItems),
    difficulty: state.difficulty === "" ? null : state.difficulty,
    childFriendly: state.childFriendly,
    privateTour: state.privateTour,
    recommendedEquipment: linesToList(state.recommendedEquipment),
    refreshmentsIncluded: state.refreshmentsIncluded,
    importantNotes: textOrNull(state.importantNotes),
    vehicle,
  };
}

const listToLines = (list: readonly string[]): string => list.join("\n");

// Rehydrate form state from a SANITIZED guidingContent value (never raw Json —
// callers pass the output of getSanitizedGuidingContent / sanitizeGuidingContent,
// which is null for absent OR malformed content).
export function hydrateTourFormState(content: GuidingContent | null): TourFormState {
  if (content === null) return emptyTourFormState();
  return {
    packageType: content.packageType,
    durationMinutes: content.durationMinutes === null ? "" : String(content.durationMinutes),
    meetingPoint: content.meetingPoint ?? "",
    pickupIncluded: content.pickup.included,
    pickupArea: content.pickup.area ?? "",
    hotelPickup: content.pickup.hotelPickup,
    airportPickup: content.pickup.airportPickup,
    maxGuests: content.maxGuests === null ? "" : String(content.maxGuests),
    languages: listToLines(content.languages),
    itinerary: content.itinerary.map((stop) => ({ title: stop.title, description: stop.description ?? "" })),
    includedItems: listToLines(content.includedItems),
    excludedItems: listToLines(content.excludedItems),
    difficulty: content.difficulty ?? "",
    childFriendly: content.childFriendly,
    privateTour: content.privateTour,
    recommendedEquipment: listToLines(content.recommendedEquipment),
    refreshmentsIncluded: content.refreshmentsIncluded,
    importantNotes: content.importantNotes ?? "",
    vehicle: content.vehicle
      ? {
          type: content.vehicle.type,
          make: content.vehicle.make ?? "",
          model: content.vehicle.model ?? "",
          year: content.vehicle.year === null ? "" : String(content.vehicle.year),
          passengerCapacity:
            content.vehicle.passengerCapacity === null ? "" : String(content.vehicle.passengerCapacity),
        }
      : { ...EMPTY_VEHICLE },
  };
}
