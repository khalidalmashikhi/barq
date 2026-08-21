// VEHICLE-LC2B — API v1 multipart adapter for vehicle-document uploads.
//
// Native clients (iOS/Android) and Web all send multipart/form-data with a `file`
// part (and, for a NEW upload, a canonical `type`). Unlike the legacy provider-Web
// routes — which call request.formData() OUTSIDE any try/catch and therefore 500 on
// a bodyless/non-form POST — this adapter NEVER throws: a malformed/missing/non-form
// body resolves to { ok: false } so the route returns a stable 400 INVALID_INPUT, no
// raw parser exception. It does NO validation of the type/file contents; the
// authoritative LC2 domain action (registry allowlist + MIME + magic-byte + size)
// remains the single source of truth.

export type ParsedVehicleDocumentUpload =
  | { ok: false } // malformed body / not multipart / parse failure
  | {
      ok: true;
      /** Canonical requirement key, or null if the `type` field was absent. */
      type: string | null;
      /** The uploaded binary, or null if no non-empty `file` part was present. */
      file: { originalFilename: string; declaredMimeType: string; bytes: ArrayBuffer } | null;
      /** VEHICLE-LC6 — OPTIONAL provider-claimed expiry date ("YYYY-MM-DD"); validated by the domain. */
      claimedExpiryDate: string | null;
    };

export async function parseVehicleDocumentUpload(request: Request): Promise<ParsedVehicleDocumentUpload> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return { ok: false }; // no body, wrong Content-Type, or unparseable → stable 400 upstream
  }

  const typeRaw = formData.get("type");
  const type = typeof typeRaw === "string" && typeRaw.length > 0 ? typeRaw : null;

  const fileRaw = formData.get("file");
  const file =
    fileRaw instanceof File && fileRaw.size > 0
      ? { originalFilename: fileRaw.name, declaredMimeType: fileRaw.type, bytes: await fileRaw.arrayBuffer() }
      : null;

  const claimRaw = formData.get("claimedExpiryDate");
  const claimedExpiryDate = typeof claimRaw === "string" && claimRaw.length > 0 ? claimRaw : null;

  return { ok: true, type, file, claimedExpiryDate };
}
