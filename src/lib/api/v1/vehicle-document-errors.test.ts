import { describe, it, expect } from "vitest";
import { vehicleDocumentErrorResponse } from "./vehicle-document-errors";
import { ASSET_DOCUMENT_ERROR_CODES } from "@/lib/vehicles/documents/asset-document-errors";

async function body(res: Response) {
  return (await res.json()) as { error: { code: string; message: string; details?: Record<string, unknown> } };
}

describe("vehicleDocumentErrorResponse", () => {
  it("maps ownership/binding not-found (both vehicle + document) to a uniform 404 NOT_FOUND", async () => {
    for (const code of ["VEHICLE_NOT_FOUND", "DOCUMENT_NOT_FOUND"] as const) {
      const res = vehicleDocumentErrorResponse(code, "en");
      expect(res.status).toBe(404);
      expect((await body(res)).error.code).toBe("NOT_FOUND");
    }
  });

  it("maps ALREADY_EXISTS→409, LOCKED→409, NOT_READY→422, INVALID_STATE→409", async () => {
    expect(vehicleDocumentErrorResponse("ALREADY_EXISTS", "en").status).toBe(409);
    expect((await body(vehicleDocumentErrorResponse("ALREADY_EXISTS", "en"))).error.code).toBe("DOCUMENT_ALREADY_EXISTS");
    expect(vehicleDocumentErrorResponse("LOCKED", "en").status).toBe(409);
    expect((await body(vehicleDocumentErrorResponse("LOCKED", "en"))).error.code).toBe("DOCUMENT_LOCKED");
    expect(vehicleDocumentErrorResponse("NOT_READY", "en").status).toBe(422);
    expect((await body(vehicleDocumentErrorResponse("INVALID_STATE", "en"))).error.code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("maps file-validation codes to 400 INVALID_INPUT with a machine-readable details.reason", async () => {
    for (const code of ["EMPTY_FILE", "TOO_LARGE", "UNSUPPORTED_TYPE", "SIGNATURE_MISMATCH"] as const) {
      const res = vehicleDocumentErrorResponse(code, "en");
      expect(res.status).toBe(400);
      const b = await body(res);
      expect(b.error.code).toBe("INVALID_INPUT");
      expect(b.error.details?.reason).toBe(code);
    }
  });

  it("carries NOT_READY submission blockers through details, without leaking internals", async () => {
    const res = vehicleDocumentErrorResponse("NOT_READY", "en", { blockers: [{ type: "VEHICLE_INSURANCE", reason: "MISSING" }] });
    const b = await body(res);
    expect(b.error.code).toBe("VERIFICATION_NOT_READY");
    expect(b.error.details?.blockers).toEqual([{ type: "VEHICLE_INSURANCE", reason: "MISSING" }]);
  });

  it("maps server-side conditions to 500 INTERNAL_ERROR (no leak)", async () => {
    for (const code of ["STORAGE_NOT_CONFIGURED", "UPLOAD_FAILED", "UNKNOWN_ERROR"] as const) {
      const res = vehicleDocumentErrorResponse(code, "en");
      expect(res.status).toBe(500);
      expect((await body(res)).error.code).toBe("INTERNAL_ERROR");
    }
  });

  it("every domain code maps to a response with a stable code + safe message + no-store", async () => {
    for (const code of ASSET_DOCUMENT_ERROR_CODES) {
      const res = vehicleDocumentErrorResponse(code, "en");
      expect(res.headers.get("cache-control")).toBe("no-store");
      const b = await body(res);
      expect(typeof b.error.code).toBe("string");
      expect(b.error.message.length).toBeGreaterThan(0);
      expect(JSON.stringify(b)).not.toMatch(/objectKey|asset-documents\/|supabase|prisma/i);
    }
  });
});
