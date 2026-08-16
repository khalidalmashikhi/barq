import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

// Mock the policy read (null => fail-closed to code defaults) and the admin doc
// list; resolveVerificationChecklist runs for real (pure).
const requirementsMock = vi.fn();
vi.mock("./get-active-verification-requirements", () => ({
  getActiveVerificationRequirements: (...a: unknown[]) => requirementsMock(...a),
}));
const listDocsMock = vi.fn();
vi.mock("./list-provider-documents-for-admin", () => ({
  listProviderDocumentsForAdmin: (...a: unknown[]) => listDocsMock(...a),
}));

const { getAdminProviderVerificationChecklist } = await import("./get-admin-provider-verification-checklist");

function adminDoc(over: Record<string, unknown>) {
  return {
    id: "d1",
    providerId: "prov-1",
    type: "IDENTITY_PROOF",
    status: "PENDING",
    originalFilename: "id.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1000,
    rejectionReason: null,
    reviewedAt: null,
    reviewedByAdminId: null,
    versionToken: "vtok",
    createdAt: new Date("2026-08-16T00:00:00.000Z"),
    updatedAt: new Date("2026-08-16T00:00:00.000Z"),
    ...over,
  };
}

afterEach(() => {
  requirementsMock.mockReset();
  listDocsMock.mockReset();
});

describe("getAdminProviderVerificationChecklist", () => {
  it("renders a MISSING required requirement as its own row (INDIVIDUAL, no uploads)", async () => {
    requirementsMock.mockResolvedValue(null); // fail-closed to code defaults
    listDocsMock.mockResolvedValue([]);

    const data = await getAdminProviderVerificationChecklist("prov-1", "INDIVIDUAL");

    const identity = data.items.find((i) => i.type === "IDENTITY_PROOF");
    expect(identity).toMatchObject({ required: true, document: null }); // visible as a row, not hidden
    expect(data.requiredTotal).toBe(1);
    expect(data.requiredApproved).toBe(0);
    // COMPANY-only requirement never leaks into an INDIVIDUAL checklist.
    expect(data.items.map((i) => i.type)).not.toContain("COMMERCIAL_REGISTRATION");
  });

  it("counts an APPROVED required document toward progress", async () => {
    requirementsMock.mockResolvedValue(null);
    listDocsMock.mockResolvedValue([adminDoc({ type: "IDENTITY_PROOF", status: "APPROVED" })]);

    const data = await getAdminProviderVerificationChecklist("prov-1", "INDIVIDUAL");
    expect(data.requiredApproved).toBe(1);
    const identity = data.items.find((i) => i.type === "IDENTITY_PROOF");
    expect(identity!.document).toMatchObject({ status: "APPROVED", versionToken: "vtok" });
  });

  it("surfaces an uploaded document whose type is no longer an active requirement (orphan row)", async () => {
    requirementsMock.mockResolvedValue(null);
    listDocsMock.mockResolvedValue([adminDoc({ id: "d9", type: "LEGACY_TYPE", status: "PENDING" })]);

    const data = await getAdminProviderVerificationChecklist("prov-1", "INDIVIDUAL");
    const orphan = data.items.find((i) => i.type === "LEGACY_TYPE");
    expect(orphan).toBeDefined();
    expect(orphan!.document).toMatchObject({ id: "d9" });
  });
});
