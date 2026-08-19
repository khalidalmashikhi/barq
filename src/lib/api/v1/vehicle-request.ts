// VEHICLE-1B — the ONLY vehicle fields a client may submit over the API, picked
// explicitly so a client can never smuggle providerId / assetType / status / any
// other field into the domain: unknown keys in the JSON body are simply not read.
// JSON types are preserved (numbers stay numbers); the domain's single strict Zod
// contract (vehicle-input.ts) is the sole validation authority. Shared by the
// POST (create) and PATCH (update) routes so the allowlist lives in one place.

export function pickVehicleInput(body: Record<string, unknown>) {
  return {
    make: body.make,
    model: body.model,
    modelYear: body.modelYear,
    color: body.color,
    vehicleType: body.vehicleType,
    passengerCapacity: body.passengerCapacity,
    publicDescription: body.publicDescription,
    registrationNumber: body.registrationNumber,
  };
}
