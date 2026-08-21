import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/uuid", () => ({ isValidUuid: (v: unknown) => typeof v === "string" && v.startsWith("asset-") }));
const requireAdminMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAdmin: (...a: unknown[]) => requireAdminMock(...a) }));
// The real token is a sha256 hash that never contains the objectKey; the mock must
// likewise NOT echo the key, so the objectKey-leak assertion is meaningful.
vi.mock("@/lib/provider/documents/document-version-token", () => ({ documentVersionToken: () => "VTOKEN" }));
const findFirstMock = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { asset: { findFirst: (...a: unknown[]) => findFirstMock(...a) } } }));

const { getAdminVehicleReview } = await import("./get-admin-vehicle-review");

const assetRow = (over: Record<string, unknown> = {}) => ({
  status: "REGISTERED",
  verificationStatus: "SUBMITTED",
  verificationSubmittedAt: new Date("2026-08-20T00:00:00Z"),
  verificationReviewedAt: null,
  verificationReason: null,
  provider: { businessName: { en: "Desert Tours", ar: "" } },
  vehicle: { make: "Toyota", model: "Land Cruiser", modelYear: 2025, color: "White", vehicleType: "FOUR_BY_FOUR", passengerCapacity: 6, registrationNumber: "OM 1", publicDescription: null },
  documents: [
    { id: "doc-reg", type: "VEHICLE_REGISTRATION", status: "PENDING", rejectionReason: null, expiresAt: null, originalFilename: "reg.pdf", mimeType: "application/pdf", sizeBytes: 100, createdAt: new Date(), reviewedAt: null, objectKey: "asset-documents/asset-1/reg/x.pdf" },
  ],
  ...over,
});

afterEach(() => vi.clearAllMocks());

describe("getAdminVehicleReview", () => {
  it("returns null for an invalid id and for a missing vehicle", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "a1" } });
    expect(await getAdminVehicleReview("bad")).toBeNull();
    findFirstMock.mockResolvedValue(null);
    expect(await getAdminVehicleReview("asset-x")).toBeNull();
  });

  it("builds the checklist with a versionToken and NEVER returns the objectKey", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "a1" } });
    findFirstMock.mockResolvedValue(assetRow());
    const review = await getAdminVehicleReview("asset-1");
    expect(review!.operationalStatus).toBe("REGISTERED");
    expect(review!.verificationStatus).toBe("SUBMITTED");
    const reg = review!.items.find((i) => i.type === "VEHICLE_REGISTRATION")!;
    expect(reg.document!.versionToken).toBe("VTOKEN");
    // Insurance is required but not uploaded → present as a null-document row.
    expect(review!.items.find((i) => i.type === "VEHICLE_INSURANCE")!.document).toBeNull();
    // Privacy: no objectKey anywhere in the serialized review.
    expect(JSON.stringify(review)).not.toContain("objectKey");
    expect(JSON.stringify(review)).not.toContain("asset-documents/");
  });

  it("§LC6 — surfaces supportsExpiry, the provider's claimed date, and the trusted date derived from expiresAt", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "a1" } });
    findFirstMock.mockResolvedValue(
      assetRow({
        documents: [
          {
            id: "doc-reg",
            type: "VEHICLE_REGISTRATION",
            status: "APPROVED",
            rejectionReason: null,
            claimedExpiryDate: "2027-05-31",
            expiresAt: new Date("2027-05-31T20:00:00.000Z"), // Oman 2027-06-01 00:00 boundary
            originalFilename: "reg.pdf",
            mimeType: "application/pdf",
            sizeBytes: 100,
            createdAt: new Date(),
            reviewedAt: null,
            objectKey: "asset-documents/asset-1/reg/x.pdf",
          },
        ],
      }),
    );
    const review = await getAdminVehicleReview("asset-1");
    const reg = review!.items.find((i) => i.type === "VEHICLE_REGISTRATION")!.document!;
    expect(reg.supportsExpiry).toBe(true);
    expect(reg.claimedExpiryDate).toBe("2027-05-31"); // advisory claim to verify
    expect(reg.trustedExpiryDate).toBe("2027-05-31"); // derived back from the trusted instant
  });

  it("§LC7 — activationBlockers: empty for REGISTERED+APPROVED+ready; flags VERIFICATION_NOT_APPROVED otherwise", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "a1" } });
    // Not-yet-approved (SUBMITTED, reg PENDING) → activation blocked.
    findFirstMock.mockResolvedValue(assetRow());
    let review = await getAdminVehicleReview("asset-1");
    expect(review!.activationBlockers.map((b) => b.reason)).toContain("VERIFICATION_NOT_APPROVED");

    // REGISTERED + APPROVED + both required docs APPROVED & unexpired → ready to activate.
    findFirstMock.mockResolvedValue(
      assetRow({
        status: "REGISTERED",
        verificationStatus: "APPROVED",
        documents: [
          { id: "doc-reg", type: "VEHICLE_REGISTRATION", status: "APPROVED", rejectionReason: null, expiresAt: null, originalFilename: "reg.pdf", mimeType: "application/pdf", sizeBytes: 100, createdAt: new Date(), reviewedAt: new Date(), objectKey: "asset-documents/asset-1/reg/x.pdf" },
          { id: "doc-ins", type: "VEHICLE_INSURANCE", status: "APPROVED", rejectionReason: null, expiresAt: null, originalFilename: "ins.pdf", mimeType: "application/pdf", sizeBytes: 100, createdAt: new Date(), reviewedAt: new Date(), objectKey: "asset-documents/asset-1/ins/x.pdf" },
        ],
      }),
    );
    review = await getAdminVehicleReview("asset-1");
    expect(review!.activationBlockers).toEqual([]);
  });

  it("surfaces approval blockers (registration PENDING + insurance missing)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "a1" } });
    findFirstMock.mockResolvedValue(assetRow());
    const review = await getAdminVehicleReview("asset-1");
    const reasons = review!.approvalBlockers.map((b) => b.reason);
    expect(reasons).toContain("REQUIRED_DOCUMENT_NOT_APPROVED"); // registration PENDING
    expect(reasons).toContain("REQUIRED_DOCUMENT_MISSING"); // insurance absent
  });
});
