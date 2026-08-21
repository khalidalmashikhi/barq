// VEHICLE-2 — the Web-form counterpart to the API's pickVehicleInput: marshal a
// provider FormData submission into the object the VEHICLE-1 domain contract
// (vehicle-input.ts) expects, forwarding ONLY the authorized fields. A client can
// never smuggle providerId/assetType/status — they are simply never read. All
// real validation stays in the single domain Zod contract; this only reshapes
// input and coerces the numeric fields (FormData carries everything as strings).

function asText(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// Empty/absent -> undefined (the domain maps that to null for a nullable field,
// or fails a required one). A numeric string -> a number. A non-numeric string is
// passed through unchanged so the domain rejects it with a clear INVALID_INPUT
// (never silently coerced to 0/NaN-as-valid).
function asNumeric(value: FormDataEntryValue | null): number | string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

// A checkbox submits its value only when checked; absent → false. TOUR-VEHICLE-CAP:
// this is the PROVIDER's advisory 4x4 claim only — the trusted capability
// (fourByFourVerified) is admin-only and is never read from provider input.
function asChecked(value: FormDataEntryValue | null): boolean {
  return value === "true";
}

export function formDataToVehicleInput(formData: FormData) {
  return {
    make: asText(formData.get("make")),
    model: asText(formData.get("model")),
    modelYear: asNumeric(formData.get("modelYear")),
    color: asText(formData.get("color")),
    vehicleType: asText(formData.get("vehicleType")),
    passengerCapacity: asNumeric(formData.get("passengerCapacity")),
    publicDescription: asText(formData.get("publicDescription")),
    registrationNumber: asText(formData.get("registrationNumber")),
    claimedFourByFour: asChecked(formData.get("claimedFourByFour")),
  };
}
