import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  REGISTRATION_FRONT_TYPE,
  REGISTRATION_BACK_TYPE,
  REGISTRATION_SET_TYPES,
  MAX_REGISTRATION_SET_PAGES,
  roleOfRegistrationType,
  sha256Hex,
  computeRegistrationSetHash,
  checkRegistrationSetShape,
} from "./registration-document-set";

// The pure rules of the registration document SET: which rows form it, what shape it may have,
// and the ONE identity (the ordered set hash) every downstream record — extraction, consent,
// confirmation binding, OCR reuse — is bound to.

const h = (s: string) => createHash("sha256").update(s).digest("hex");

describe("registration document set — types and roles", () => {
  it("the set is the front/primary row plus the optional back row, in that order", () => {
    expect(REGISTRATION_FRONT_TYPE).toBe("VEHICLE_REGISTRATION");
    expect(REGISTRATION_BACK_TYPE).toBe("VEHICLE_REGISTRATION_BACK");
    expect([...REGISTRATION_SET_TYPES]).toEqual(["VEHICLE_REGISTRATION", "VEHICLE_REGISTRATION_BACK"]);
    expect(MAX_REGISTRATION_SET_PAGES).toBe(2);
  });

  it("maps a stored type to its role; any other document type is not part of the set", () => {
    expect(roleOfRegistrationType("VEHICLE_REGISTRATION")).toBe("FRONT");
    expect(roleOfRegistrationType("VEHICLE_REGISTRATION_BACK")).toBe("BACK");
    expect(roleOfRegistrationType("VEHICLE_INSURANCE")).toBeNull();
    expect(roleOfRegistrationType("")).toBeNull();
  });
});

describe("registration document set — the ORDERED set hash", () => {
  const A = h("front-bytes"), B = h("back-bytes");

  it("a single page hashes to ITS OWN hash — every single-document record made before this gate keeps its identity unchanged", () => {
    expect(computeRegistrationSetHash([A])).toBe(A);
  });

  it("two pages hash to a value that is neither page's hash and that depends on the ORDER", () => {
    const ab = computeRegistrationSetHash([A, B]);
    const ba = computeRegistrationSetHash([B, A]);
    expect(ab).not.toBe(A);
    expect(ab).not.toBe(B);
    expect(ab).not.toBe(ba); // swapping the sides is a different set
    expect(ab).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic and byte-sensitive: replacing either side changes it; a partial set never equals the complete one", () => {
    const ab = computeRegistrationSetHash([A, B]);
    expect(computeRegistrationSetHash([A, B])).toBe(ab);
    expect(computeRegistrationSetHash([h("front-bytes-v2"), B])).not.toBe(ab);
    expect(computeRegistrationSetHash([A, h("back-bytes-v2")])).not.toBe(ab);
    expect(computeRegistrationSetHash([A])).not.toBe(ab); // front alone ≠ front + back
  });

  it("refuses an empty set and more than two pages", () => {
    expect(() => computeRegistrationSetHash([])).toThrow();
    expect(() => computeRegistrationSetHash([A, B, h("c")])).toThrow();
  });

  it("sha256Hex hashes exactly the bytes it is given", () => {
    const bytes = new TextEncoder().encode("front-bytes").buffer as ArrayBuffer;
    expect(sha256Hex(bytes)).toBe(A);
  });
});

describe("registration document set — shape", () => {
  const pdf = (role: "FRONT" | "BACK") => ({ role, mimeType: "application/pdf" });
  const img = (role: "FRONT" | "BACK", mimeType = "image/jpeg") => ({ role, mimeType });

  it("valid: one PDF alone; one photo alone; front photo + back photo", () => {
    expect(checkRegistrationSetShape([pdf("FRONT")])).toBeNull();
    expect(checkRegistrationSetShape([img("FRONT")])).toBeNull();
    expect(checkRegistrationSetShape([img("FRONT"), img("BACK", "image/png")])).toBeNull();
  });

  it("invalid: a PDF never travels with a photo; a back side is never a PDF", () => {
    expect(checkRegistrationSetShape([pdf("FRONT"), img("BACK")])).toBe("PDF_WITH_IMAGE");
    expect(checkRegistrationSetShape([img("FRONT"), pdf("BACK")])).toBe("BACK_MUST_BE_IMAGE");
    expect(checkRegistrationSetShape([pdf("FRONT"), pdf("BACK")])).toBe("BACK_MUST_BE_IMAGE"); // never two PDFs
  });

  it("invalid: nothing, more than two pages, or a back side without a front", () => {
    expect(checkRegistrationSetShape([])).toBe("EMPTY_SET");
    expect(checkRegistrationSetShape([img("FRONT"), img("BACK"), img("BACK")])).toBe("TOO_MANY_PAGES");
    expect(checkRegistrationSetShape([img("BACK")])).toBe("FRONT_MISSING");
  });
});
