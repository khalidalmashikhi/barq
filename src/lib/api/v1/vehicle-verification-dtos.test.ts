import { describe, it, expect } from "vitest";
import { toVehicleVerificationApiDTO } from "./vehicle-verification-dtos";
import type { VehicleVerificationData } from "@/lib/vehicles/documents/get-asset-verification-data";

const data: VehicleVerificationData = {
  operationalStatus: "REGISTERED",
  verificationStatus: "CHANGES_REQUESTED",
  verificationSubmittedAt: new Date("2026-08-19T10:00:00.000Z"),
  editable: true,
  submittable: false,
  submissionBlockers: [{ type: "VEHICLE_INSURANCE", reason: "MISSING" }],
  verificationReason: "Registration is blurry",
  items: [
    { type: "VEHICLE_REGISTRATION", labelKey: "assetDocumentTypeVehicleRegistration", required: true, supportsExpiry: true, claimedExpiryDate: null, documentId: "doc-reg", status: "REJECTED", rejectionReason: "Unreadable", expiresAt: new Date("2027-01-01T00:00:00.000Z"), validThroughDate: "2027-01-01", isExpired: false, isRemediable: false, canUpload: false, canReplace: true, canDelete: true, canView: true },
    { type: "VEHICLE_INSURANCE", labelKey: "assetDocumentTypeVehicleInsurance", required: true, supportsExpiry: true, claimedExpiryDate: null, documentId: null, status: null, rejectionReason: null, expiresAt: null, validThroughDate: null, isExpired: false, isRemediable: false, canUpload: true, canReplace: false, canDelete: false, canView: false },
  ],
};

describe("toVehicleVerificationApiDTO", () => {
  it("maps the two axes, ISO timestamps, canonical keys, and submission state", () => {
    const dto = toVehicleVerificationApiDTO("veh-1", data);
    expect(dto.vehicleId).toBe("veh-1");
    expect(dto.operationalStatus).toBe("REGISTERED"); // separate from verificationStatus
    expect(dto.verificationStatus).toBe("CHANGES_REQUESTED");
    expect(dto.verificationSubmittedAt).toBe("2026-08-19T10:00:00.000Z"); // ISO-8601 string
    expect(dto.verificationReason).toBe("Registration is blurry");
    expect(dto.submission).toEqual({ canSubmit: false, blockers: [{ type: "VEHICLE_INSURANCE", reason: "MISSING" }] });
  });

  it("shapes an uploaded requirement's document (id/status/rejection/expiry ISO) + capabilities", () => {
    const dto = toVehicleVerificationApiDTO("veh-1", data);
    const reg = dto.requirements.find((r) => r.key === "VEHICLE_REGISTRATION")!;
    expect(reg.required).toBe(true);
    expect(reg.document).toEqual({ id: "doc-reg", status: "REJECTED", rejectionReason: "Unreadable", claimedExpiryDate: null, expiresAt: "2027-01-01T00:00:00.000Z", validThroughDate: "2027-01-01", isExpired: false, isRemediable: false });
    expect(reg.required).toBe(true);
    expect(reg.supportsExpiry).toBe(true); // LC6 — requirement-level expiry policy
    expect(reg.capabilities).toEqual({ canUpload: false, canReplace: true, canDelete: true, canView: true });
  });

  it("emits document:null for a not-yet-uploaded requirement", () => {
    const dto = toVehicleVerificationApiDTO("veh-1", data);
    const ins = dto.requirements.find((r) => r.key === "VEHICLE_INSURANCE")!;
    expect(ins.document).toBeNull();
    expect(ins.capabilities.canUpload).toBe(true);
  });

  it("null verificationSubmittedAt stays null (never an epoch string)", () => {
    const dto = toVehicleVerificationApiDTO("veh-1", { ...data, verificationSubmittedAt: null });
    expect(dto.verificationSubmittedAt).toBeNull();
  });

  it("§21 — surfaces the derived isExpired flag per document (server authority)", () => {
    const expired = { ...data, items: data.items.map((i) => (i.documentId ? { ...i, isExpired: true } : i)) };
    const dto = toVehicleVerificationApiDTO("veh-1", expired);
    expect(dto.requirements.find((r) => r.key === "VEHICLE_REGISTRATION")!.document!.isExpired).toBe(true);
  });

  it("§7 (LC5) — surfaces the derived isRemediable flag per document (server authority)", () => {
    const remediable = { ...data, items: data.items.map((i) => (i.documentId ? { ...i, isRemediable: true } : i)) };
    const dto = toVehicleVerificationApiDTO("veh-1", remediable);
    expect(dto.requirements.find((r) => r.key === "VEHICLE_REGISTRATION")!.document!.isRemediable).toBe(true);
  });

  it("§LC6 — surfaces the provider-claimed expiry date (advisory) + requirement supportsExpiry, distinct from trusted expiresAt", () => {
    const claimed = { ...data, items: data.items.map((i) => (i.documentId ? { ...i, claimedExpiryDate: "2027-05-31" } : i)) };
    const dto = toVehicleVerificationApiDTO("veh-1", claimed);
    const reg = dto.requirements.find((r) => r.key === "VEHICLE_REGISTRATION")!;
    expect(reg.supportsExpiry).toBe(true);
    expect(reg.document!.claimedExpiryDate).toBe("2027-05-31"); // advisory
    expect(reg.document!.expiresAt).toBe("2027-01-01T00:00:00.000Z"); // trusted (unchanged by the claim)
  });

  it("§QA-D1 — surfaces the server-derived validThroughDate (business date) alongside the raw expiresAt instant", () => {
    const dto = toVehicleVerificationApiDTO("veh-1", data);
    const reg = dto.requirements.find((r) => r.key === "VEHICLE_REGISTRATION")!;
    expect(reg.document!.validThroughDate).toBe("2027-01-01"); // display value
    expect(reg.document!.expiresAt).toBe("2027-01-01T00:00:00.000Z"); // raw instant retained for logic
  });

  it("NEVER serializes objectKey, reviewedByAdminId, bucket, or a labelKey", () => {
    const json = JSON.stringify(toVehicleVerificationApiDTO("veh-1", data));
    expect(json).not.toContain("objectKey");
    expect(json).not.toContain("reviewedByAdminId");
    expect(json).not.toContain("bucket");
    expect(json).not.toContain("labelKey");
    expect(json).not.toContain("assetDocumentType"); // no UI label keys on the wire
  });
});
