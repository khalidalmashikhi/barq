import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 3C Slice C2b-R2 (correction) — transaction-authority integration: the REAL bridge
// (evaluateRentalServicePublishable is NOT mocked here) runs inside the provider + admin publish
// transactions. Proves the AUTHORITATIVE in-transaction compliance decision uses the transaction
// client — a vertical that is APPROVED at preflight (global) but SUSPENDED on the tx must FAIL the
// publish with no status update and no audit; a fully-compliant tx graph publishes.

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT"); }) }));

vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: vi.fn().mockResolvedValue({ provider: { id: "provider-1", providerType: "INDIVIDUAL" } }),
  requirePermission: vi.fn().mockResolvedValue({ barqUser: {}, actor: { actorType: "ADMIN", actorId: "admin-1", admin: { id: "admin-1" }, isOwner: false } }),
  requireAdmin: vi.fn().mockResolvedValue({ admin: { id: "admin-1" } }),
  UnauthenticatedError: class extends Error {},
  ForbiddenError: class extends Error {},
}));
vi.mock("./activities/assert-provider-authorized-for-category", () => ({ isProviderAuthorizedForCategory: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/tour-template/resolve-tourist-guide-category", () => ({ resolveTouristGuideCategoryId: vi.fn().mockResolvedValue("tour-cat") }));

const SERVICE_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
const KEY = "RENTAL_ACTIVITY_LICENCE";
const RENTAL_SERVICE = { id: SERVICE_ID, providerId: "provider-1", status: "DRAFT", categoryId: "cat-1", offeringKind: "VEHICLE_RENTAL", legacyVerticalExempt: false, serviceType: "RENTAL" };
const VEHICLE_DOCS = [
  { type: "VEHICLE_REGISTRATION", status: "APPROVED", expiresAt: null },
  { type: "VEHICLE_INSURANCE", status: "APPROVED", expiresAt: null },
];
const READY_VEHICLE = { assetId: "veh-1", bookablePassengerCapacity: 7, asset: { providerId: "provider-1", assetType: "VEHICLE", status: "ACTIVE", verificationStatus: "APPROVED", documents: VEHICLE_DOCS } };
const PUBLISHED_OFFERING = { id: "off-1", baseDailyAmount: "40.00", currency: "OMR", offeringCapacityOverride: null, vehicle: READY_VEHICLE };

// A compliance/offering graph. `verticalStatus` differs between the global preflight and the tx to
// prove which one is authoritative. Vehicles carry no required docs here, so an ACTIVE+APPROVED asset
// with an empty required-doc policy is selectable; the RENTAL_COMPANY doc policy is satisfied.
function graph(verticalStatus: string, opts: { auditThrows?: boolean } = {}) {
  const auditCreate = vi.fn(() => (opts.auditThrows ? Promise.reject(new Error("audit insert failed")) : Promise.resolve({})));
  const update = vi.fn().mockResolvedValue({});
  const delegates = () => ({
    service: { findUnique: vi.fn().mockResolvedValue(RENTAL_SERVICE) },
    provider: { findUnique: vi.fn().mockResolvedValue({ status: "APPROVED" }) },
    price: { findFirst: vi.fn().mockResolvedValue(null) }, // no legacy ACTIVE Price → Path B only
    providerVertical: { findUnique: vi.fn().mockResolvedValue({ status: verticalStatus }) },
    providerVerificationRequirement: { findMany: vi.fn().mockResolvedValue([{ key: KEY, appliesTo: "RENTAL_COMPANY", required: true, active: true, evidenceExpires: false }]) },
    providerDocument: { findMany: vi.fn().mockResolvedValue([{ type: KEY, status: "APPROVED", expiresAt: null }]) },
    rentalOffering: { findMany: vi.fn().mockResolvedValue([PUBLISHED_OFFERING]) },
    rentalOfferingDay: { findFirst: vi.fn().mockResolvedValue({ id: "day-1" }) }, // an OPEN non-past day
    category: { findUnique: vi.fn().mockResolvedValue({ id: "cat-1" }) },
    experience: { findUnique: vi.fn().mockResolvedValue(null) },
    tourServiceVehicle: { findMany: vi.fn().mockResolvedValue([]) },
  });
  return { auditCreate, update, delegates };
}

// Build a global prisma (preflight — always APPROVED+valid so it never blocks) whose $transaction
// runs the callback with a TX client whose vertical status is `txVerticalStatus`.
function buildDb(txVerticalStatus: string, opts: { auditThrows?: boolean } = {}) {
  const g = graph("APPROVED"); // preflight graph: fully compliant
  const t = graph(txVerticalStatus, opts); // in-transaction graph
  const globalDelegates = g.delegates();
  const txDelegates = t.delegates();
  const prisma = {
    ...globalDelegates,
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({ ...txDelegates, service: { ...txDelegates.service, update: t.update }, auditLog: { create: t.auditCreate } }),
  };
  return { prisma, txUpdate: t.update, txAudit: t.auditCreate, globalDelegates };
}

let current: ReturnType<typeof buildDb>;
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (current.prisma as Record<string | symbol, unknown>)[p] }) }));

const { publishService: providerPublish } = await import("./transition-service-status");
const { publishService: adminPublish } = await import("@/lib/admin/transition-service-status");

beforeEach(() => vi.clearAllMocks());

describe("provider publishService — real bridge, transaction-authoritative compliance", () => {
  it("publishes when the tx graph is fully compliant + has a valid PUBLISHED offering with an OPEN day (Path B)", async () => {
    current = buildDb("APPROVED");
    expect(await providerPublish(SERVICE_ID)).toEqual({ ok: true });
    expect(current.txUpdate).toHaveBeenCalledWith({ where: { id: SERVICE_ID }, data: { status: "PUBLISHED" } });
  });

  it("tx vertical SUSPENDED (preflight global APPROVED) → NO_ACTIVE_PRICE, NO status update, NO audit (tx is authoritative)", async () => {
    current = buildDb("SUSPENDED");
    expect(await providerPublish(SERVICE_ID)).toEqual({ ok: false, error: "NO_ACTIVE_PRICE", blockers: ["NO_ACTIVE_PRICE"] });
    expect(current.txUpdate).not.toHaveBeenCalled();
    expect(current.txAudit).not.toHaveBeenCalled();
  });

  it("tx vertical REJECTED → publish fails, no update/audit", async () => {
    current = buildDb("REJECTED");
    expect(await providerPublish(SERVICE_ID)).toEqual({ ok: false, error: "NO_ACTIVE_PRICE", blockers: ["NO_ACTIVE_PRICE"] });
    expect(current.txUpdate).not.toHaveBeenCalled();
  });

  it("an audit-write failure rolls back the publish (returns UNKNOWN_ERROR)", async () => {
    current = buildDb("APPROVED", { auditThrows: true });
    expect(await providerPublish(SERVICE_ID)).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
  });
});

describe("admin publishService — real bridge, transaction-authoritative compliance (governance is not exempt)", () => {
  it("publishes when the tx graph is fully compliant (Path B)", async () => {
    current = buildDb("APPROVED");
    expect(await adminPublish(SERVICE_ID)).toEqual({ ok: true });
    expect(current.txUpdate).toHaveBeenCalledWith({ where: { id: SERVICE_ID }, data: { status: "PUBLISHED" } });
  });

  it("tx vertical SUSPENDED → NO_ACTIVE_PRICE, no update/audit", async () => {
    current = buildDb("SUSPENDED");
    expect(await adminPublish(SERVICE_ID)).toEqual({ ok: false, error: "NO_ACTIVE_PRICE", blockers: ["NO_ACTIVE_PRICE"] });
    expect(current.txUpdate).not.toHaveBeenCalled();
  });
});
