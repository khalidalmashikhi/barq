import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/uuid", () => ({ isValidUuid: (v: unknown) => typeof v === "string" && v.startsWith("asset-") }));

const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a) }));

const assetFindFirstMock = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { asset: { findFirst: (...a: unknown[]) => assetFindFirstMock(...a) } } }));

const { getVehicleVerificationData } = await import("./get-asset-verification-data");

const byType = (data: Awaited<ReturnType<typeof getVehicleVerificationData>>, type: string) => data!.items.find((i) => i.type === type)!;

afterEach(() => vi.clearAllMocks());

describe("getVehicleVerificationData", () => {
  it("returns null for an invalid id before any query", async () => {
    expect(await getVehicleVerificationData("bad")).toBeNull();
    expect(requireApprovedProviderMock).not.toHaveBeenCalled();
  });

  it("returns null for a foreign/missing vehicle (ownership-scoped)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    assetFindFirstMock.mockResolvedValue(null);
    expect(await getVehicleVerificationData("asset-x")).toBeNull();
    expect(assetFindFirstMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "asset-x", providerId: "prov-1", assetType: "VEHICLE" } }));
  });

  it("§19/§27 — reports isExpired for a past-expiry doc (and false for future), never leaks objectKey", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    assetFindFirstMock.mockResolvedValue({
      status: "REGISTERED",
      verificationStatus: "APPROVED",
      verificationSubmittedAt: null,
      verificationReason: null,
      documents: [
        { id: "doc-reg", type: "VEHICLE_REGISTRATION", status: "APPROVED", rejectionReason: null, expiresAt: new Date("2000-01-01T00:00:00Z") },
        { id: "doc-ins", type: "VEHICLE_INSURANCE", status: "APPROVED", rejectionReason: null, expiresAt: new Date("2999-01-01T00:00:00Z") },
      ],
    });
    const data = await getVehicleVerificationData("asset-1");
    expect(byType(data, "VEHICLE_REGISTRATION").isExpired).toBe(true); // past expiry
    expect(byType(data, "VEHICLE_INSURANCE").isExpired).toBe(false); // future expiry
    expect(JSON.stringify(data)).not.toContain("objectKey");
  });

  it("builds the checklist with per-item capabilities for an editable DRAFT vehicle", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    assetFindFirstMock.mockResolvedValue({
      status: "REGISTERED",
      verificationStatus: "DRAFT",
      verificationSubmittedAt: null,
      verificationReason: null,
      documents: [{ id: "doc-reg", type: "VEHICLE_REGISTRATION", status: "PENDING", rejectionReason: null, expiresAt: null }],
    });
    const data = await getVehicleVerificationData("asset-1");
    expect(data!.editable).toBe(true);
    expect(data!.submittable).toBe(false); // insurance missing
    expect(data!.submissionBlockers).toEqual([{ type: "VEHICLE_INSURANCE", reason: "MISSING" }]);

    const reg = byType(data, "VEHICLE_REGISTRATION");
    expect(reg).toMatchObject({ documentId: "doc-reg", status: "PENDING", canUpload: false, canReplace: true, canDelete: true, canView: true });

    const ins = byType(data, "VEHICLE_INSURANCE");
    expect(ins).toMatchObject({ documentId: null, status: null, canUpload: true, canReplace: false, canDelete: false, canView: false });
  });

  it("locks all mutation capabilities once SUBMITTED (still viewable)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    assetFindFirstMock.mockResolvedValue({
      status: "REGISTERED",
      verificationStatus: "SUBMITTED",
      verificationSubmittedAt: new Date("2026-08-20T00:00:00Z"),
      verificationReason: null,
      documents: [
        { id: "doc-reg", type: "VEHICLE_REGISTRATION", status: "PENDING", rejectionReason: null, expiresAt: null },
        { id: "doc-ins", type: "VEHICLE_INSURANCE", status: "PENDING", rejectionReason: null, expiresAt: null },
      ],
    });
    const data = await getVehicleVerificationData("asset-1");
    expect(data!.editable).toBe(false);
    expect(data!.operationalStatus).toBe("REGISTERED"); // two-axis: operational stays REGISTERED
    for (const item of data!.items) {
      expect(item.canUpload).toBe(false);
      expect(item.canReplace).toBe(false);
      expect(item.canDelete).toBe(false);
      expect(item.canView).toBe(true);
    }
  });

  it("never selects or returns the objectKey (privacy)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    assetFindFirstMock.mockResolvedValue({ verificationStatus: "DRAFT", verificationReason: null, documents: [] });
    const data = await getVehicleVerificationData("asset-1");
    const select = assetFindFirstMock.mock.calls[0]![0].select;
    expect(select.documents.select).not.toHaveProperty("objectKey");
    expect(JSON.stringify(data)).not.toContain("objectKey");
  });

  it("surfaces the admin reason and rejection reason for a CHANGES_REQUESTED vehicle", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    assetFindFirstMock.mockResolvedValue({
      status: "REGISTERED",
      verificationStatus: "CHANGES_REQUESTED",
      verificationSubmittedAt: new Date("2026-08-19T00:00:00Z"),
      verificationReason: "Registration is blurry",
      documents: [
        { id: "doc-reg", type: "VEHICLE_REGISTRATION", status: "REJECTED", rejectionReason: "Unreadable scan", expiresAt: null },
        { id: "doc-ins", type: "VEHICLE_INSURANCE", status: "PENDING", rejectionReason: null, expiresAt: null },
      ],
    });
    const data = await getVehicleVerificationData("asset-1");
    expect(data!.verificationReason).toBe("Registration is blurry");
    expect(byType(data, "VEHICLE_REGISTRATION").rejectionReason).toBe("Unreadable scan");
    // A REJECTED required doc blocks submission until replaced.
    expect(data!.submittable).toBe(false);
  });
});
