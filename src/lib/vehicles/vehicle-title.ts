// Deterministic vehicle display title — VEHICLE-2. There is NO DB name/title
// field (and this gate adds none): the title is derived from make + model.
// Pure and null-safe: legacy/partial rows (either or both absent) never crash a
// render. Returns null when nothing usable exists so the caller can substitute a
// localized fallback label (e.g. t("vehicleUntitled")) rather than an empty gap.

export function buildVehicleTitle(make: string | null | undefined, model: string | null | undefined): string | null {
  const parts = [make, model].map((p) => (typeof p === "string" ? p.trim() : "")).filter((p) => p.length > 0);
  return parts.length > 0 ? parts.join(" ") : null;
}
