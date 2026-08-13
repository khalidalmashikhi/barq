import { describe, it, expect, vi, afterEach } from "vitest";

// Provider Verification & Documents — the single provider-side read that backs
// both /provider/verification and the dashboard readiness card. Mocks
// requireProvider, prisma (providerDocument.findMany + providerVerificationRequirement
// .findMany) and the storage config probe; documentVersionToken is exercised for
// real (sha256 of objectKey), so rows carry a real objectKey and the returned
// token is opaque (never the objectKey).
//
// ADR-0017: the checklist now comes from the configured policy (audience-filtered)
// with a fail-CLOSED fallback to the code defaults. Note the deliberate refinement
// vs. the pre-ADR behaviour: a COMPANY no longer sees an irrelevant optional
// IDENTITY_PROOF slot — only requirements whose audience covers the provider type
// (its own type, or BOTH) are shown. BR-029 (which docs BLOCK approval) is
// unchanged.

vi.mock("server-only", () => ({}));

const requireProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireProvider: (...a: unknown[]) => requireProviderMock(...a),
}));

const findManyMock = vi.fn();
const requirementFindManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    providerDocument: { findMany: (...a: unknown[]) => findManyMock(...a) },
    providerVerificationRequirement: { findMany: (...a: unknown[]) => requirementFindManyMock(...a) },
  },
}));

const storageConfiguredMock = vi.fn();
vi.mock("@/lib/storage/storage", () => ({
  isDocumentStorageConfigured: (...a: unknown[]) => storageConfiguredMock(...a),
}));

const { getProviderVerificationData } = await import("./get-provider-verification-data");

// The seeded default policy rows (what the staging bootstrap creates), returned
// by the requirement delegate for the "seeded policy" tests.
const SEEDED_ROWS = [
  {
    key: "IDENTITY_PROOF",
    name: { ar: "إثبات الهوية", en: "Identity Proof" },
    description: { ar: "وصف", en: "Identity description" },
    appliesTo: "INDIVIDUAL",
    required: true,
    active: true,
    sortOrder: 0,
  },
  {
    key: "COMMERCIAL_REGISTRATION",
    name: { ar: "السجل التجاري", en: "Commercial Registration" },
    description: { ar: "وصف", en: "CR description" },
    appliesTo: "COMPANY",
    required: true,
    active: true,
    sortOrder: 1,
  },
  {
    key: "TOURISM_LICENCE",
    name: { ar: "الترخيص السياحي", en: "Tourism Licence" },
    description: { ar: "وصف", en: "Licence description" },
    appliesTo: "BOTH",
    required: false,
    active: true,
    sortOrder: 2,
  },
];

afterEach(() => {
  requireProviderMock.mockReset();
  findManyMock.mockReset();
  requirementFindManyMock.mockReset();
  storageConfiguredMock.mockReset();
});

function doc(overrides: Record<string, unknown>) {
  return {
    id: "d1",
    type: "IDENTITY_PROOF",
    status: "APPROVED",
    originalFilename: "id.pdf",
    sizeBytes: 1234,
    rejectionReason: null,
    objectKey: "provider-documents/prov-1/identity_proof/v1.pdf",
    ...overrides,
  };
}

describe("getProviderVerificationData — seeded policy", () => {
  it("shows the audience-applicable checklist (required first) for a COMPANY with no uploads", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", providerType: "COMPANY", status: "APPLIED" } });
    findManyMock.mockResolvedValue([]);
    requirementFindManyMock.mockResolvedValue(SEEDED_ROWS);
    storageConfiguredMock.mockReturnValue(true);

    const data = await getProviderVerificationData();

    expect(data.requiredTotal).toBe(1);
    expect(data.requiredApproved).toBe(0);
    // Required (COMMERCIAL_REGISTRATION) leads, then the BOTH optional TOURISM_LICENCE.
    expect(data.items.map((i) => i.type)).toEqual(["COMMERCIAL_REGISTRATION", "TOURISM_LICENCE"]);
    expect(data.items[0]).toMatchObject({ type: "COMMERCIAL_REGISTRATION", required: true, document: null });
    // The INDIVIDUAL-only IDENTITY_PROOF is NOT shown to a COMPANY (audience filter).
    expect(data.items.map((i) => i.type)).not.toContain("IDENTITY_PROOF");
  });

  it("shows IDENTITY_PROOF (required) + TOURISM_LICENCE (optional) for an INDIVIDUAL", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", providerType: "INDIVIDUAL", status: "APPLIED" } });
    findManyMock.mockResolvedValue([]);
    requirementFindManyMock.mockResolvedValue(SEEDED_ROWS);
    storageConfiguredMock.mockReturnValue(true);

    const data = await getProviderVerificationData();

    expect(data.items.map((i) => i.type)).toEqual(["IDENTITY_PROOF", "TOURISM_LICENCE"]);
    expect(data.items.find((i) => i.type === "IDENTITY_PROOF")!.required).toBe(true);
    expect(data.items.find((i) => i.type === "TOURISM_LICENCE")!.required).toBe(false);
    expect(data.items.map((i) => i.type)).not.toContain("COMMERCIAL_REGISTRATION");
  });

  it("returns the bilingual name/description for each checklist item", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", providerType: "COMPANY", status: "APPLIED" } });
    findManyMock.mockResolvedValue([]);
    requirementFindManyMock.mockResolvedValue(SEEDED_ROWS);
    storageConfiguredMock.mockReturnValue(true);

    const data = await getProviderVerificationData();

    const cr = data.items.find((i) => i.type === "COMMERCIAL_REGISTRATION")!;
    expect(cr.name).toEqual({ ar: "السجل التجاري", en: "Commercial Registration" });
    expect(cr.description).toEqual({ ar: "وصف", en: "CR description" });
  });

  it("counts an APPROVED required document and exposes an opaque versionToken (never the objectKey)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", providerType: "INDIVIDUAL", status: "APPROVED" } });
    findManyMock.mockResolvedValue([doc({ type: "IDENTITY_PROOF", status: "APPROVED" })]);
    requirementFindManyMock.mockResolvedValue(SEEDED_ROWS);
    storageConfiguredMock.mockReturnValue(true);

    const data = await getProviderVerificationData();

    expect(data.requiredTotal).toBe(1);
    expect(data.requiredApproved).toBe(1);
    const identity = data.items.find((i) => i.type === "IDENTITY_PROOF")!;
    expect(identity.required).toBe(true);
    expect(identity.document).toMatchObject({ id: "d1", status: "APPROVED", originalFilename: "id.pdf" });
    expect(typeof identity.document!.versionToken).toBe("string");
    expect(identity.document!.versionToken).not.toContain("provider-documents");
    expect(identity.document!).not.toHaveProperty("objectKey");
  });

  it("does not count a PENDING required document toward requiredApproved", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", providerType: "INDIVIDUAL", status: "UNDER_REVIEW" } });
    findManyMock.mockResolvedValue([doc({ type: "IDENTITY_PROOF", status: "PENDING" })]);
    requirementFindManyMock.mockResolvedValue(SEEDED_ROWS);
    storageConfiguredMock.mockReturnValue(true);

    const data = await getProviderVerificationData();

    expect(data.requiredApproved).toBe(0);
  });

  it("reflects a custom active policy (checklist follows the configured rows)", async () => {
    // Admin added an active custom required requirement for companies.
    const custom = [
      ...SEEDED_ROWS,
      {
        key: "VAT_CERTIFICATE",
        name: { ar: "شهادة ضريبة", en: "VAT Certificate" },
        description: null,
        appliesTo: "COMPANY",
        required: true,
        active: true,
        sortOrder: 3,
      },
    ];
    requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", providerType: "COMPANY", status: "APPLIED" } });
    findManyMock.mockResolvedValue([]);
    requirementFindManyMock.mockResolvedValue(custom);
    storageConfiguredMock.mockReturnValue(true);

    const data = await getProviderVerificationData();

    expect(data.items.map((i) => i.type)).toEqual(["COMMERCIAL_REGISTRATION", "TOURISM_LICENCE", "VAT_CERTIFICATE"]);
    expect(data.requiredTotal).toBe(2); // CR + VAT
  });
});

describe("getProviderVerificationData — fail-closed fallback", () => {
  it("falls back to the code-default checklist when the policy read FAILS (DB error)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", providerType: "INDIVIDUAL", status: "APPLIED" } });
    findManyMock.mockResolvedValue([]);
    requirementFindManyMock.mockRejectedValue(new Error("db down"));
    storageConfiguredMock.mockReturnValue(true);

    const data = await getProviderVerificationData();

    // Never empty on failure — the default INDIVIDUAL checklist is shown.
    expect(data.requiredTotal).toBe(1);
    expect(data.items.find((i) => i.type === "IDENTITY_PROOF")!.required).toBe(true);
    expect(data.items.length).toBeGreaterThan(0);
  });

  it("falls back to the code-default checklist when the policy table is EMPTY (unseeded)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", providerType: "COMPANY", status: "APPLIED" } });
    findManyMock.mockResolvedValue([]);
    requirementFindManyMock.mockResolvedValue([]);
    storageConfiguredMock.mockReturnValue(true);

    const data = await getProviderVerificationData();

    expect(data.requiredTotal).toBe(1);
    expect(data.items.find((i) => i.type === "COMMERCIAL_REGISTRATION")!.required).toBe(true);
  });

  it("reflects storage availability from isDocumentStorageConfigured", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", providerType: "INDIVIDUAL", status: "APPLIED" } });
    findManyMock.mockResolvedValue([]);
    requirementFindManyMock.mockResolvedValue(SEEDED_ROWS);
    storageConfiguredMock.mockReturnValue(false);

    const data = await getProviderVerificationData();

    expect(data.storageAvailable).toBe(false);
  });
});
