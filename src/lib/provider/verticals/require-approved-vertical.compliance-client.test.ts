import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));

// The GLOBAL prisma. Every delegate the compliance path could touch is a spy; in the "supplied
// client" suite they are set to THROW, so ANY accidental global read (including the vertical STATUS
// read that previously leaked) fails the test loudly.
vi.mock("@/lib/db", () => ({
  prisma: {
    providerVertical: { findUnique: vi.fn() },
    providerVerificationRequirement: { findMany: vi.fn() },
    providerDocument: { findMany: vi.fn() },
  },
}));

import { evaluateVerticalCompliance } from "./require-approved-vertical";
import { prisma } from "@/lib/db";

const PROVIDER = "prov-1";
const VERTICAL = "RENTAL_COMPANY" as const;
const KEY = "RENTAL_ACTIVITY_LICENCE";
const COMPLIANT_REQS = [{ key: KEY, appliesTo: "RENTAL_COMPANY", required: true, active: true, evidenceExpires: false }];
const APPROVED_DOCS = [{ type: KEY, status: "APPROVED", expiresAt: null }];

function txClient(opts: { status: string | null; reqs?: unknown[]; docs?: unknown[] }) {
  return {
    providerVertical: { findUnique: vi.fn().mockResolvedValue(opts.status === null ? null : { status: opts.status }) },
    providerVerificationRequirement: { findMany: vi.fn().mockResolvedValue(opts.reqs ?? COMPLIANT_REQS) },
    providerDocument: { findMany: vi.fn().mockResolvedValue(opts.docs ?? APPROVED_DOCS) },
  };
}
const g = () => prisma as unknown as {
  providerVertical: { findUnique: Mock };
  providerVerificationRequirement: { findMany: Mock };
  providerDocument: { findMany: Mock };
};

describe("evaluateVerticalCompliance — supplied transaction client is used for ALL compliance reads (incl. status)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const t = () => { throw new Error("GLOBAL PRISMA MUST NOT BE USED WHEN A CLIENT IS SUPPLIED"); };
    g().providerVertical.findUnique.mockImplementation(t);
    g().providerVerificationRequirement.findMany.mockImplementation(t);
    g().providerDocument.findMany.mockImplementation(t);
  });

  it("reads vertical STATUS + requirements + documents through the supplied client; global prisma is never touched", async () => {
    const tx = txClient({ status: "APPROVED" });
    const result = await evaluateVerticalCompliance(PROVIDER, VERTICAL, tx as never);
    expect(result).toEqual({ compliant: true, status: "APPROVED" });
    expect(tx.providerVertical.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.providerVerificationRequirement.findMany).toHaveBeenCalledTimes(1);
    expect(tx.providerDocument.findMany).toHaveBeenCalledTimes(1);
    expect(g().providerVertical.findUnique).not.toHaveBeenCalled();
    expect(g().providerVerificationRequirement.findMany).not.toHaveBeenCalled();
    expect(g().providerDocument.findMany).not.toHaveBeenCalled();
  });

  it("global prisma throws, but the supplied client succeeds → authoritative evaluation succeeds (proves no global read)", async () => {
    const tx = txClient({ status: "APPROVED" });
    await expect(evaluateVerticalCompliance(PROVIDER, VERTICAL, tx as never)).resolves.toEqual({ compliant: true, status: "APPROVED" });
  });

  it("supplied client denies (SUSPENDED) even though global would allow → non-compliant via the supplied status", async () => {
    const tx = txClient({ status: "SUSPENDED" });
    const result = await evaluateVerticalCompliance(PROVIDER, VERTICAL, tx as never);
    expect(result).toMatchObject({ compliant: false, reason: "VERTICAL_REJECTED_OR_SUSPENDED" });
    expect(g().providerVertical.findUnique).not.toHaveBeenCalled();
  });

  it("supplied client sees a REJECTED status change → non-compliant", async () => {
    const result = await evaluateVerticalCompliance(PROVIDER, VERTICAL, txClient({ status: "REJECTED" }) as never);
    expect(result).toMatchObject({ compliant: false, reason: "VERTICAL_REJECTED_OR_SUSPENDED" });
  });

  it("supplied client: APPROVED but evidence expired → not compliant (DOCUMENTS_INCOMPLETE), via the supplied documents", async () => {
    const past = new Date("2000-01-01T00:00:00.000Z");
    const tx = txClient({ status: "APPROVED", reqs: [{ key: KEY, appliesTo: "RENTAL_COMPANY", required: true, active: true, evidenceExpires: true }], docs: [{ type: KEY, status: "APPROVED", expiresAt: past }] });
    const result = await evaluateVerticalCompliance(PROVIDER, VERTICAL, tx as never);
    expect(result).toMatchObject({ compliant: false, reason: "VERTICAL_DOCUMENTS_INCOMPLETE" });
  });

  it("supplied client: APPROVED but policy not configured (no active required requirements) → not compliant", async () => {
    const tx = txClient({ status: "APPROVED", reqs: [] });
    const result = await evaluateVerticalCompliance(PROVIDER, VERTICAL, tx as never);
    expect(result).toMatchObject({ compliant: false, reason: "VERTICAL_POLICY_NOT_CONFIGURED" });
  });
});

describe("evaluateVerticalCompliance — existing callers with NO supplied client use the default global prisma", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    g().providerVertical.findUnique.mockResolvedValue({ status: "APPROVED" });
    g().providerVerificationRequirement.findMany.mockResolvedValue(COMPLIANT_REQS);
    g().providerDocument.findMany.mockResolvedValue(APPROVED_DOCS);
  });

  it("no db argument → reads through the global prisma and returns the same result (unchanged behavior)", async () => {
    const result = await evaluateVerticalCompliance(PROVIDER, VERTICAL);
    expect(result).toEqual({ compliant: true, status: "APPROVED" });
    expect(g().providerVertical.findUnique).toHaveBeenCalledTimes(1);
    expect(g().providerVerificationRequirement.findMany).toHaveBeenCalledTimes(1);
    expect(g().providerDocument.findMany).toHaveBeenCalledTimes(1);
  });
});
