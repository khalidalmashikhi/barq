// API v1 request-body adapter — Gate PC (Provider Mutation API).
//
// The authoritative provider mutations (src/lib/provider/**, src/lib/booking/**)
// are server actions that read their inputs from a `FormData`. Rather than
// duplicate any of their validation, the mutation routes accept a JSON body and
// translate it into the exact `FormData` those actions already expect — the same
// thin JSON→FormData adapter precedent Gate 3 (createBooking) established. All
// real validation stays in the domain action; this module only reshapes input.
//
// FIELD PRESENCE IS PRESERVED FAITHFULLY, because several actions distinguish an
// ABSENT field (leave unchanged) from a PRESENT-but-empty field (explicit clear)
// — e.g. update-service.ts's regionCode/pricingUnit and update-provider-profile's
// logoUrl. To match that: a JSON value that is a string (INCLUDING "") is appended
// (present); a value that is `undefined` or `null` is skipped (absent). To CLEAR a
// clearable field, a client sends "" — never JSON null.

/**
 * Safely parse a JSON request body into a plain object. Returns `{}` for an empty
 * body, invalid JSON, or a non-object (array/primitive) — the domain action then
 * sees only missing fields and returns its own INVALID_INPUT. Never throws.
 */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const data = await request.json();
    return data !== null && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Coerce a single JSON value to the string a `FormData` text field would carry, or
 * `undefined` to mean "field absent". Strings (including "") pass through verbatim;
 * finite numbers are stringified (so a client may send `capacity: 4` or `"4"`, and
 * `priceAmount: 25` or `"25.00"`); everything else (null/undefined/boolean/object)
 * becomes `undefined` (absent) — the domain action then rejects anything malformed.
 */
export function coerceField(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/**
 * Build a `FormData` from a field map, appending only the fields whose coerced
 * value is a string (present); `undefined` entries are skipped (absent). This is
 * the single choke point that preserves the absent-vs-empty distinction above.
 */
export function buildFormData(fields: Record<string, string | undefined>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) formData.append(key, value);
  }
  return formData;
}
