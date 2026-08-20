import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
const getProviderVehicleMock = vi.fn();
const getVerificationMock = vi.fn();
vi.mock("@/lib/vehicles/queries/get-provider-vehicle", () => ({ getProviderVehicle: (...a: unknown[]) => getProviderVehicleMock(...a) }));
vi.mock("@/lib/vehicles/documents/get-asset-verification-data", () => ({ getVehicleVerificationData: (...a: unknown[]) => getVerificationMock(...a) }));
vi.mock("@/lib/i18n/get-server-translator", () => ({ getServerTranslator: async () => (k: string) => k }));
// The verification section uses getTranslations from next-intl/server.
vi.mock("next-intl/server", () => ({ getLocale: async () => "en", getTranslations: async () => (k: string) => k }));
vi.mock("@/i18n/navigation", () => ({ Link: (props: Record<string, unknown>) => props }));
const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));

const { default: VehicleDetailPage } = await import("./page");

type AnyEl = { type: unknown; props: Record<string, unknown> };
function collectHrefs(el: unknown, acc: string[] = []): string[] {
  if (!el || typeof el !== "object") return acc;
  if (Array.isArray(el)) return el.forEach((c) => collectHrefs(c, acc)), acc;
  const e = el as AnyEl;
  if (typeof e.props?.href === "string") acc.push(e.props.href as string);
  collectHrefs(e.props?.children, acc);
  return acc;
}
function allStrings(el: unknown, acc: string[] = []): string[] {
  if (typeof el === "string") return acc.push(el), acc;
  if (!el || typeof el !== "object") return acc;
  if (Array.isArray(el)) return el.forEach((c) => allStrings(c, acc)), acc;
  for (const v of Object.values((el as AnyEl).props ?? {})) allStrings(v, acc);
  return acc;
}
const vehicle = {
  id: "veh-1",
  make: "Toyota",
  model: "Land Cruiser",
  modelYear: 2025,
  color: "White",
  vehicleType: "FOUR_BY_FOUR",
  passengerCapacity: 6,
  publicDescription: "Desert-ready.",
  registrationNumber: "OM 12345",
  status: "REGISTERED",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const editableVerification = {
  verificationStatus: "DRAFT",
  editable: true,
  submittable: false,
  submissionBlockers: [{ type: "VEHICLE_REGISTRATION", reason: "MISSING" }],
  verificationReason: null,
  items: [
    { type: "VEHICLE_REGISTRATION", labelKey: "assetDocumentTypeVehicleRegistration", required: true, documentId: null, status: null, rejectionReason: null, expiresAt: null, canUpload: true, canReplace: false, canDelete: false, canView: false },
    { type: "VEHICLE_INSURANCE", labelKey: "assetDocumentTypeVehicleInsurance", required: true, documentId: "doc-9", status: "PENDING", rejectionReason: null, expiresAt: null, canUpload: false, canReplace: true, canDelete: true, canView: true },
  ],
};

const call = (id: string, sp: Record<string, string> = {}) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve(sp) });

afterEach(() => {
  getProviderVehicleMock.mockReset();
  getVerificationMock.mockReset();
  notFoundMock.mockClear();
});

describe("VehicleDetailPage", () => {
  it("renders the private vehicle fields and an Edit link", async () => {
    getProviderVehicleMock.mockResolvedValue(vehicle);
    getVerificationMock.mockResolvedValue(null);
    const el = await VehicleDetailPage(call("veh-1"));
    const strings = allStrings(el);
    expect(strings).toContain("Toyota Land Cruiser");
    expect(strings).toContain("OM 12345"); // private reg shown to owner
    expect(strings).toContain("Desert-ready.");
    expect(collectHrefs(el)).toContain("/provider/vehicles/veh-1/edit");
  });

  it("keeps the details card display-only — no operational activate/deactivate/maintenance/delete control", async () => {
    getProviderVehicleMock.mockResolvedValue(vehicle);
    getVerificationMock.mockResolvedValue(null); // no verification section → nothing but the details card
    const el = await VehicleDetailPage(call("veh-1"));
    let hasForm = false;
    const walk = (n: unknown) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      const e = n as AnyEl;
      if (e.type === "form" || e.type === "button") hasForm = true;
      walk(e.props?.children);
    };
    walk(el);
    expect(hasForm).toBe(false); // the details card itself never mutates
  });

  it("mounts the verification section with the read-model data when present", async () => {
    getProviderVehicleMock.mockResolvedValue(vehicle);
    getVerificationMock.mockResolvedValue(editableVerification);
    const el = await VehicleDetailPage(call("veh-1"));
    // The section is an async server component — assert it is mounted with the
    // right props (its deep output is covered in the component's own test).
    let found: Record<string, unknown> | null = null;
    const walk = (n: unknown) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      const e = n as AnyEl;
      if (typeof e.type === "function" && (e.type as { name?: string }).name === "VehicleVerificationSection") found = e.props;
      walk(e.props?.children);
    };
    walk(el);
    expect(found).not.toBeNull();
    expect(found).toMatchObject({ vehicleId: "veh-1", data: editableVerification });
  });

  it("does NOT mount the verification section when the read model returns null", async () => {
    getProviderVehicleMock.mockResolvedValue(vehicle);
    getVerificationMock.mockResolvedValue(null);
    const el = await VehicleDetailPage(call("veh-1"));
    let found = false;
    const walk = (n: unknown) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      const e = n as AnyEl;
      if (typeof e.type === "function" && (e.type as { name?: string }).name === "VehicleVerificationSection") found = true;
      walk(e.props?.children);
    };
    walk(el);
    expect(found).toBe(false);
  });

  it("surfaces a success notice after an upload redirect (?docNotice=uploaded)", async () => {
    getProviderVehicleMock.mockResolvedValue(vehicle);
    getVerificationMock.mockResolvedValue(editableVerification);
    const el = await VehicleDetailPage(call("veh-1", { docNotice: "uploaded" }));
    expect(allStrings(el)).toContain("vehicleDocNoticeUploaded");
  });

  it("surfaces a mapped error after a failed mutation (?docError=ALREADY_EXISTS)", async () => {
    getProviderVehicleMock.mockResolvedValue(vehicle);
    getVerificationMock.mockResolvedValue(editableVerification);
    const el = await VehicleDetailPage(call("veh-1", { docError: "ALREADY_EXISTS" }));
    expect(allStrings(el)).toContain("vehicleDocErrorAlreadyExists");
  });

  it("ignores an unknown/garbage error code (no crash, no banner key)", async () => {
    getProviderVehicleMock.mockResolvedValue(vehicle);
    getVerificationMock.mockResolvedValue(editableVerification);
    const el = await VehicleDetailPage(call("veh-1", { docError: "__nope__" }));
    expect(allStrings(el)).not.toContain("__nope__");
  });

  it("calls notFound() for a foreign/missing vehicle (never enumerable)", async () => {
    getProviderVehicleMock.mockResolvedValue(null);
    getVerificationMock.mockResolvedValue(null);
    await expect(VehicleDetailPage(call("foreign"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });
});
