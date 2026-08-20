import { describe, it, expect, vi } from "vitest";

vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));

const { VehicleVerificationSection } = await import("./vehicle-verification-section");
import type { VehicleVerificationData } from "@/lib/vehicles/documents/get-asset-verification-data";

type AnyEl = { type: unknown; props: Record<string, unknown> };
function collect(el: unknown, pred: (e: AnyEl) => void): void {
  if (!el || typeof el !== "object") return;
  if (Array.isArray(el)) return el.forEach((c) => collect(c, pred));
  const e = el as AnyEl;
  pred(e);
  collect(e.props?.children, pred);
}
function actions(el: unknown): string[] {
  const out: string[] = [];
  collect(el, (e) => {
    if (typeof e.props?.action === "string") out.push(e.props.action as string);
  });
  return out;
}
function hrefs(el: unknown): string[] {
  const out: string[] = [];
  collect(el, (e) => {
    if (typeof e.props?.href === "string") out.push(e.props.href as string);
  });
  return out;
}
function strings(el: unknown): string[] {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (typeof n === "string") return void out.push(n);
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    for (const v of Object.values((n as AnyEl).props ?? {})) walk(v);
  };
  walk(el);
  return out;
}

const base: VehicleVerificationData = {
  operationalStatus: "REGISTERED",
  verificationStatus: "DRAFT",
  verificationSubmittedAt: null,
  editable: true,
  submittable: false,
  submissionBlockers: [{ type: "VEHICLE_INSURANCE", reason: "MISSING" }],
  verificationReason: null,
  items: [
    { type: "VEHICLE_REGISTRATION", labelKey: "assetDocumentTypeVehicleRegistration", required: true, documentId: "doc-reg", status: "PENDING", rejectionReason: null, expiresAt: null, canUpload: false, canReplace: true, canDelete: true, canView: true },
    { type: "VEHICLE_INSURANCE", labelKey: "assetDocumentTypeVehicleInsurance", required: true, documentId: null, status: null, rejectionReason: null, expiresAt: null, canUpload: true, canReplace: false, canDelete: false, canView: false },
  ],
};

describe("VehicleVerificationSection", () => {
  it("renders upload/replace/delete forms + view link targeting the vehicle-scoped API", async () => {
    const el = await VehicleVerificationSection({ vehicleId: "veh-1", locale: "en", data: base });
    const a = actions(el);
    expect(a).toContain("/api/provider/vehicles/veh-1/documents"); // upload (insurance, missing)
    expect(a).toContain("/api/provider/vehicles/veh-1/documents/doc-reg/replace");
    expect(a).toContain("/api/provider/vehicles/veh-1/documents/doc-reg/delete");
    expect(a).toContain("/api/provider/vehicles/veh-1/verification/submit");
    expect(hrefs(el)).toContain("/api/provider/vehicles/veh-1/documents/doc-reg/view");
  });

  it("shows the verification status + submit control while editable", async () => {
    const el = await VehicleVerificationSection({ vehicleId: "veh-1", locale: "en", data: base });
    const s = strings(el);
    expect(s).toContain("vehicleVerifyStatusDraft"); // verification axis
    expect(s).toContain("vehicleSubmitVerificationButton");
    expect(s).toContain("vehicleSubmitBlockedHint"); // not submittable yet
  });

  it("never renders an objectKey anywhere in the section", async () => {
    const withKeyish = { ...base, verificationReason: "please fix" };
    const el = await VehicleVerificationSection({ vehicleId: "veh-1", locale: "en", data: withKeyish });
    expect(JSON.stringify(el)).not.toContain("objectKey");
    expect(JSON.stringify(el)).not.toContain("asset-documents/");
  });

  it("renders NO mutation forms when the vehicle is locked (SUBMITTED)", async () => {
    const locked: VehicleVerificationData = {
      ...base,
      verificationStatus: "SUBMITTED",
      editable: false, // locked while awaiting admin review
      submittable: false,
      items: base.items.map((i) => ({ ...i, canUpload: false, canReplace: false, canDelete: false, canView: Boolean(i.documentId) })),
    };
    const el = await VehicleVerificationSection({ vehicleId: "veh-1", locale: "en", data: locked });
    const a = actions(el);
    expect(a).not.toContain("/api/provider/vehicles/veh-1/verification/submit"); // no submit when not editable
    expect(a.every((x) => !x.endsWith("/replace") && !x.endsWith("/delete") && !x.endsWith("/documents"))).toBe(true);
    // Status still shown.
    expect(strings(el)).toContain("vehicleVerifyStatusSubmitted");
  });

  it("surfaces the admin reason for a CHANGES_REQUESTED vehicle", async () => {
    const changes: VehicleVerificationData = { ...base, verificationStatus: "CHANGES_REQUESTED", verificationReason: "Docs unclear" };
    const el = await VehicleVerificationSection({ vehicleId: "veh-1", locale: "en", data: changes });
    expect(strings(el)).toContain("Docs unclear");
  });
});
