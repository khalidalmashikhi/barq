import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Phase 3B — Phase 1. The server-side authorization guards for regulated listings. These are the
// SOLE authority for "may this provider create/publish this listing kind"; a category grant never
// confers it (there is no ProviderCategory read here at all). Every product-pinned rule is asserted:
// pending-can-draft-not-publish, approved-can-publish, rejected/suspended locked out, the
// grandfathering exemption, and the impossibility of using a null kind to bypass the publish gate.

vi.mock("server-only", () => ({}));

const providerVerticalFindUniqueMock = vi.fn();
// Publishing / acceptance for an APPROVED vertical additionally run the compliance readiness
// (policy + documents + expiry), so the requirement + document readers are mocked too.
const requirementFindManyMock = vi.fn();
const documentFindManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    providerVertical: { findUnique: (...a: unknown[]) => providerVerticalFindUniqueMock(...a) },
    providerVerificationRequirement: { findMany: (...a: unknown[]) => requirementFindManyMock(...a) },
    providerDocument: { findMany: (...a: unknown[]) => documentFindManyMock(...a) },
  },
}));

const { assertCanCreateListing, assertCanPublishListing, getProviderVerticalStatus, assertVerticalAllowsBookingAcceptance } =
  await import("./require-approved-vertical");

const PROVIDER = "provider-1";

function verticalStatus(status: string | null) {
  providerVerticalFindUniqueMock.mockResolvedValue(status === null ? null : { status });
}
// Default compliance = a configured, satisfied RENTAL_COMPANY policy (the tests use VEHICLE_RENTAL).
function compliantPolicy() {
  requirementFindManyMock.mockResolvedValue([
    { key: "RENTAL_ACTIVITY_LICENCE", appliesTo: "RENTAL_COMPANY", required: true, active: true, evidenceExpires: false },
  ]);
  documentFindManyMock.mockResolvedValue([{ type: "RENTAL_ACTIVITY_LICENCE", status: "APPROVED", expiresAt: null }]);
}

afterEach(() => vi.clearAllMocks());
beforeEach(() => {
  providerVerticalFindUniqueMock.mockReset();
  requirementFindManyMock.mockReset();
  documentFindManyMock.mockReset();
  compliantPolicy();
});

describe("assertCanCreateListing (draft authorization)", () => {
  it("never gates an unregulated (null/undefined) kind and does not even read the DB", async () => {
    expect(await assertCanCreateListing(PROVIDER, null)).toBeNull();
    expect(await assertCanCreateListing(PROVIDER, undefined)).toBeNull();
    expect(providerVerticalFindUniqueMock).not.toHaveBeenCalled();
  });

  it("denies a regulated create when the vertical was never requested (no row)", async () => {
    verticalStatus(null);
    expect(await assertCanCreateListing(PROVIDER, "VEHICLE_RENTAL")).toBe("VERTICAL_NOT_REQUESTED");
  });

  it("ALLOWS drafting while PENDING_REVIEW / CHANGES_REQUESTED / APPROVED", async () => {
    for (const s of ["PENDING_REVIEW", "CHANGES_REQUESTED", "APPROVED"]) {
      verticalStatus(s);
      expect(await assertCanCreateListing(PROVIDER, "VEHICLE_RENTAL")).toBeNull();
    }
  });

  it("denies drafting while REJECTED or SUSPENDED", async () => {
    for (const s of ["REJECTED", "SUSPENDED"]) {
      verticalStatus(s);
      expect(await assertCanCreateListing(PROVIDER, "VEHICLE_RENTAL")).toBe("VERTICAL_REJECTED_OR_SUSPENDED");
    }
  });

  it("reads the RENTAL_COMPANY vertical for a VEHICLE_RENTAL kind", async () => {
    verticalStatus("APPROVED");
    await assertCanCreateListing(PROVIDER, "VEHICLE_RENTAL");
    expect(providerVerticalFindUniqueMock).toHaveBeenCalledWith({
      where: { providerId_vertical: { providerId: PROVIDER, vertical: "RENTAL_COMPANY" } },
      select: { status: true },
    });
  });
});

describe("assertCanPublishListing (publish authorization)", () => {
  const base = { providerId: PROVIDER, legacyVerticalExempt: false };

  it("never gates an unregulated (null) kind — a null-kind service is unreachable by the publish gate", async () => {
    expect(await assertCanPublishListing({ ...base, offeringKind: null })).toBeNull();
    expect(providerVerticalFindUniqueMock).not.toHaveBeenCalled();
  });

  it("requires an APPROVED vertical to publish a regulated listing", async () => {
    verticalStatus("APPROVED");
    expect(await assertCanPublishListing({ ...base, offeringKind: "VEHICLE_RENTAL" })).toBeNull();
  });

  it("blocks publish while merely requested (PENDING_REVIEW / CHANGES_REQUESTED) → VERTICAL_NOT_APPROVED", async () => {
    for (const s of ["PENDING_REVIEW", "CHANGES_REQUESTED"]) {
      verticalStatus(s);
      expect(await assertCanPublishListing({ ...base, offeringKind: "VEHICLE_RENTAL" })).toBe("VERTICAL_NOT_APPROVED");
    }
  });

  it("blocks publish when the vertical was never requested → VERTICAL_NOT_REQUESTED", async () => {
    verticalStatus(null);
    expect(await assertCanPublishListing({ ...base, offeringKind: "VEHICLE_RENTAL" })).toBe("VERTICAL_NOT_REQUESTED");
  });

  it("blocks publish while REJECTED or SUSPENDED → VERTICAL_REJECTED_OR_SUSPENDED", async () => {
    for (const s of ["REJECTED", "SUSPENDED"]) {
      verticalStatus(s);
      expect(await assertCanPublishListing({ ...base, offeringKind: "VEHICLE_RENTAL" })).toBe(
        "VERTICAL_REJECTED_OR_SUSPENDED"
      );
    }
  });

  it("GRANDFATHERING: a legacyVerticalExempt regulated listing publishes without an APPROVED vertical (pending / never-requested)", async () => {
    verticalStatus("PENDING_REVIEW");
    expect(
      await assertCanPublishListing({ providerId: PROVIDER, offeringKind: "VEHICLE_RENTAL", legacyVerticalExempt: true })
    ).toBeNull();
    verticalStatus(null);
    expect(
      await assertCanPublishListing({ providerId: PROVIDER, offeringKind: "VEHICLE_RENTAL", legacyVerticalExempt: true })
    ).toBeNull();
  });

  it("GRANDFATHERING DOES NOT OVERRIDE ENFORCEMENT: a SUSPENDED (or REJECTED) vertical blocks republish even for an exempt listing", async () => {
    for (const s of ["SUSPENDED", "REJECTED"]) {
      verticalStatus(s);
      expect(
        await assertCanPublishListing({ providerId: PROVIDER, offeringKind: "VEHICLE_RENTAL", legacyVerticalExempt: true })
      ).toBe("VERTICAL_REJECTED_OR_SUSPENDED");
    }
  });

  it("separation: a RENTAL_COMPANY provider cannot publish a TOUR listing (wrong vertical, not requested)", async () => {
    // Provider holds RENTAL_COMPANY (APPROVED) but the TOUR listing needs TOURIST_GUIDE. The guard
    // reads the TOURIST_GUIDE row — absent → not requested.
    verticalStatus(null);
    expect(await assertCanPublishListing({ ...base, offeringKind: "TOUR" })).toBe("VERTICAL_NOT_REQUESTED");
    expect(providerVerticalFindUniqueMock).toHaveBeenCalledWith({
      where: { providerId_vertical: { providerId: PROVIDER, vertical: "TOURIST_GUIDE" } },
      select: { status: true },
    });
  });
});

describe("assertVerticalAllowsBookingAcceptance (Blocker 4)", () => {
  it("never blocks a non-regulated (null) kind and does not read the DB", async () => {
    expect(await assertVerticalAllowsBookingAcceptance({ providerId: PROVIDER, offeringKind: null })).toBeNull();
    expect(providerVerticalFindUniqueMock).not.toHaveBeenCalled();
  });

  it("FREEZES acceptance when the vertical is SUSPENDED or REJECTED", async () => {
    for (const s of ["SUSPENDED", "REJECTED"]) {
      verticalStatus(s);
      expect(await assertVerticalAllowsBookingAcceptance({ providerId: PROVIDER, offeringKind: "VEHICLE_RENTAL" })).toBe(
        "VERTICAL_REJECTED_OR_SUSPENDED"
      );
    }
  });

  it("allows acceptance for a non-punitive vertical state (null / PENDING / CHANGES / APPROVED) — existing bookings are honored", async () => {
    for (const s of [null, "PENDING_REVIEW", "CHANGES_REQUESTED", "APPROVED"]) {
      verticalStatus(s);
      expect(await assertVerticalAllowsBookingAcceptance({ providerId: PROVIDER, offeringKind: "VEHICLE_RENTAL" })).toBeNull();
    }
  });
});

describe("runtime compliance (Item 5): APPROVED is necessary but not sufficient", () => {
  const PAST = new Date(Date.now() - 24 * 3600 * 1000);

  it("PUBLISH is blocked when APPROVED but the required policy is EMPTY (fail closed)", async () => {
    verticalStatus("APPROVED");
    requirementFindManyMock.mockResolvedValue([]); // policy emptied after approval
    expect(await assertCanPublishListing({ providerId: PROVIDER, offeringKind: "VEHICLE_RENTAL", legacyVerticalExempt: false })).toBe(
      "VERTICAL_POLICY_NOT_CONFIGURED"
    );
  });

  it("PUBLISH is blocked when APPROVED but a required licence has EXPIRED", async () => {
    verticalStatus("APPROVED");
    requirementFindManyMock.mockResolvedValue([
      { key: "RENTAL_ACTIVITY_LICENCE", appliesTo: "RENTAL_COMPANY", required: true, active: true, evidenceExpires: true },
    ]);
    documentFindManyMock.mockResolvedValue([{ type: "RENTAL_ACTIVITY_LICENCE", status: "APPROVED", expiresAt: PAST }]);
    expect(await assertCanPublishListing({ providerId: PROVIDER, offeringKind: "VEHICLE_RENTAL", legacyVerticalExempt: false })).toBe(
      "VERTICAL_DOCUMENTS_INCOMPLETE"
    );
  });

  it("PUBLISH is allowed when APPROVED and compliant (default satisfied policy)", async () => {
    verticalStatus("APPROVED");
    expect(await assertCanPublishListing({ providerId: PROVIDER, offeringKind: "VEHICLE_RENTAL", legacyVerticalExempt: false })).toBeNull();
  });

  it("GRANDFATHERED (exempt) listing still bypasses compliance when NOT suspended", async () => {
    verticalStatus("APPROVED");
    requirementFindManyMock.mockResolvedValue([]); // even an empty policy
    expect(await assertCanPublishListing({ providerId: PROVIDER, offeringKind: "VEHICLE_RENTAL", legacyVerticalExempt: true })).toBeNull();
  });

  it("ACCEPTANCE is frozen when APPROVED but a required licence has EXPIRED", async () => {
    verticalStatus("APPROVED");
    requirementFindManyMock.mockResolvedValue([
      { key: "RENTAL_ACTIVITY_LICENCE", appliesTo: "RENTAL_COMPANY", required: true, active: true, evidenceExpires: true },
    ]);
    documentFindManyMock.mockResolvedValue([{ type: "RENTAL_ACTIVITY_LICENCE", status: "APPROVED", expiresAt: PAST }]);
    expect(await assertVerticalAllowsBookingAcceptance({ providerId: PROVIDER, offeringKind: "VEHICLE_RENTAL" })).toBe(
      "VERTICAL_DOCUMENTS_INCOMPLETE"
    );
  });

  it("ACCEPTANCE is allowed when APPROVED and compliant", async () => {
    verticalStatus("APPROVED");
    expect(await assertVerticalAllowsBookingAcceptance({ providerId: PROVIDER, offeringKind: "VEHICLE_RENTAL" })).toBeNull();
  });
});

describe("getProviderVerticalStatus", () => {
  it("returns the row status or null when absent", async () => {
    verticalStatus("APPROVED");
    expect(await getProviderVerticalStatus(PROVIDER, "RENTAL_COMPANY")).toBe("APPROVED");
    verticalStatus(null);
    expect(await getProviderVerticalStatus(PROVIDER, "RENTAL_COMPANY")).toBeNull();
  });
});
