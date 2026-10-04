// Phase 3C Slice 3B — the ONE definition of "this vehicle's document-first setup is not finished".
// Pure (no I/O), so the provider list, the detail/edit pages and the update guard all agree.
//
// A vehicle whose `make` is null has no confirmed profile: it is an onboarding shell created at
// document upload whose values have not been reviewed + confirmed yet. `make` is required by the
// confirmation contract, so it is non-null for every finalized vehicle (and for every vehicle created
// through the former direct form). An incomplete vehicle must be completed through the review step —
// it is never editable directly, never selectable, never public.

export function isVehicleSetupIncomplete(vehicle: { make: string | null }): boolean {
  return vehicle.make === null;
}
