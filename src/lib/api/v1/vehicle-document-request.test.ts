import { describe, it, expect } from "vitest";
import { parseVehicleDocumentUpload } from "./vehicle-document-request";

const URL = "http://x/api/v1/me/provider/vehicles/veh-1/documents";

function multipart(parts: { type?: string; file?: { name: string; mime: string; content: string } }) {
  const fd = new FormData();
  if (parts.type !== undefined) fd.append("type", parts.type);
  if (parts.file) fd.append("file", new File([parts.file.content], parts.file.name, { type: parts.file.mime }));
  return new Request(URL, { method: "POST", body: fd });
}

describe("parseVehicleDocumentUpload (multipart hardening)", () => {
  it("parses a valid multipart upload (type + file)", async () => {
    const req = multipart({ type: "VEHICLE_REGISTRATION", file: { name: "reg.pdf", mime: "application/pdf", content: "abc" } });
    const parsed = await parseVehicleDocumentUpload(req);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.type).toBe("VEHICLE_REGISTRATION");
      expect(parsed.file?.originalFilename).toBe("reg.pdf");
      expect(parsed.file?.declaredMimeType).toBe("application/pdf");
      expect(parsed.file?.bytes.byteLength).toBe(3);
    }
  });

  it("returns ok:false for a bodyless POST (no 500 upstream)", async () => {
    const parsed = await parseVehicleDocumentUpload(new Request(URL, { method: "POST" }));
    expect(parsed.ok).toBe(false);
  });

  it("returns ok:false for a non-multipart JSON body (wrong Content-Type)", async () => {
    const req = new Request(URL, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const parsed = await parseVehicleDocumentUpload(req);
    expect(parsed.ok).toBe(false);
  });

  it("parses but reports a missing file as file:null", async () => {
    const parsed = await parseVehicleDocumentUpload(multipart({ type: "VEHICLE_REGISTRATION" }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.file).toBeNull();
  });

  it("parses but reports a missing type as type:null", async () => {
    const parsed = await parseVehicleDocumentUpload(multipart({ file: { name: "x.pdf", mime: "application/pdf", content: "a" } }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.type).toBeNull();
  });

  it("treats an empty (0-byte) file as file:null", async () => {
    const parsed = await parseVehicleDocumentUpload(multipart({ type: "VEHICLE_REGISTRATION", file: { name: "x.pdf", mime: "application/pdf", content: "" } }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.file).toBeNull();
  });
});
