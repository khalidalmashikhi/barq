import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));

// The GLOBAL prisma client. Its delegates are spies that MUST NOT be called once a transaction
// client is supplied to the authorization functions — that is the whole point of the C2b-R
// transaction-authority fix (mutable authorization facts are re-read on the mutation's tx, not on a
// separate global-client snapshot).
vi.mock("@/lib/db", () => ({
  prisma: {
    provider: { findUnique: vi.fn() },
    providerVertical: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { assertProviderStillApproved, assertRentalDraftAuthorized } from "./rental-offering-authorization";
import { assertCanCreateListing, getProviderVerticalStatus } from "@/lib/provider/verticals/require-approved-vertical";

const PROVIDER = "prov-1";

// A stand-in transaction client exposing only the delegates the authorization path touches.
function makeTxClient() {
  return {
    provider: { findUnique: vi.fn() },
    providerVertical: { findUnique: vi.fn() },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assertProviderStillApproved — in-transaction provider-status re-read", () => {
  it("reads Provider.status through the SUPPLIED tx client, never the global prisma", async () => {
    const tx = makeTxClient();
    tx.provider.findUnique.mockResolvedValue({ status: "APPROVED" });
    expect(await assertProviderStillApproved(tx as never, PROVIDER)).toBeNull();
    expect(tx.provider.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.provider.findUnique).toHaveBeenCalledWith({ where: { id: PROVIDER }, select: { status: true } });
    expect((prisma as unknown as { provider: { findUnique: Mock } }).provider.findUnique).not.toHaveBeenCalled();
  });

  it("maps a non-APPROVED status to PROVIDER_NOT_APPROVED", async () => {
    for (const status of ["SUSPENDED", "REJECTED", "DEACTIVATED", "UNDER_REVIEW", "DRAFT", "APPLIED", "CHANGES_REQUESTED"]) {
      const tx = makeTxClient();
      tx.provider.findUnique.mockResolvedValue({ status });
      expect(await assertProviderStillApproved(tx as never, PROVIDER)).toBe("PROVIDER_NOT_APPROVED");
    }
  });

  it("maps a missing provider row to NO_PROVIDER_PROFILE", async () => {
    const tx = makeTxClient();
    tx.provider.findUnique.mockResolvedValue(null);
    expect(await assertProviderStillApproved(tx as never, PROVIDER)).toBe("NO_PROVIDER_PROFILE");
  });
});

describe("assertRentalDraftAuthorized — vertical draft eligibility on the tx client", () => {
  async function draftWith(status: string | null) {
    const tx = makeTxClient();
    tx.providerVertical.findUnique.mockResolvedValue(status === null ? null : { status });
    const result = await assertRentalDraftAuthorized(tx as never, PROVIDER);
    return { result, tx };
  }

  it("uses the SUPPLIED tx client for the vertical-status lookup, never the global prisma", async () => {
    const { tx } = await draftWith("APPROVED");
    expect(tx.providerVertical.findUnique).toHaveBeenCalledTimes(1);
    expect((prisma as unknown as { providerVertical: { findUnique: Mock } }).providerVertical.findUnique).not.toHaveBeenCalled();
  });

  it("permits DRAFT preparation for PENDING_REVIEW / CHANGES_REQUESTED / APPROVED", async () => {
    for (const status of ["PENDING_REVIEW", "CHANGES_REQUESTED", "APPROVED"]) {
      expect((await draftWith(status)).result).toBeNull();
    }
  });

  it("fails closed (VERTICAL_NOT_AUTHORIZED) for REJECTED / SUSPENDED", async () => {
    for (const status of ["REJECTED", "SUSPENDED"]) {
      expect((await draftWith(status)).result).toBe("VERTICAL_NOT_AUTHORIZED");
    }
  });

  it("fails closed when the RENTAL_COMPANY vertical is missing — a provider's categories never substitute", async () => {
    const { result } = await draftWith(null); // no vertical row at all
    expect(result).toBe("VERTICAL_NOT_AUTHORIZED");
  });
});

describe("existing Phase 3B callers are unaffected (default global prisma when no db is passed)", () => {
  it("getProviderVerticalStatus with no db argument reads via the global prisma", async () => {
    (prisma as unknown as { providerVertical: { findUnique: Mock } }).providerVertical.findUnique.mockResolvedValue({ status: "APPROVED" });
    const status = await getProviderVerticalStatus(PROVIDER, "RENTAL_COMPANY");
    expect(status).toBe("APPROVED");
    expect((prisma as unknown as { providerVertical: { findUnique: Mock } }).providerVertical.findUnique).toHaveBeenCalledTimes(1);
  });

  it("assertCanCreateListing with no db argument reads via the global prisma and applies the same policy", async () => {
    (prisma as unknown as { providerVertical: { findUnique: Mock } }).providerVertical.findUnique.mockResolvedValue({ status: "APPROVED" });
    expect(await assertCanCreateListing(PROVIDER, "VEHICLE_RENTAL")).toBeNull();
    expect((prisma as unknown as { providerVertical: { findUnique: Mock } }).providerVertical.findUnique).toHaveBeenCalledTimes(1);
  });
});
