import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
const requireAdminMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAdmin: (...a: unknown[]) => requireAdminMock(...a) }));
const findManyMock = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { asset: { findMany: (...a: unknown[]) => findManyMock(...a) } } }));

const { getVehicleReviewQueue } = await import("./get-vehicle-review-queue");

afterEach(() => vi.clearAllMocks());

describe("getVehicleReviewQueue", () => {
  it("queries SUBMITTED (initial) + APPROVED-with-pending-required (LC5 remediation) and maps doc progress + kind", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "a1" } });
    findManyMock.mockResolvedValue([
      {
        id: "asset-1",
        verificationStatus: "SUBMITTED",
        verificationSubmittedAt: new Date("2026-08-20T00:00:00Z"),
        provider: { businessName: { en: "Desert Tours", ar: "" } },
        vehicle: { make: "Toyota", model: "Land Cruiser", modelYear: 2025, vehicleType: "FOUR_BY_FOUR" },
        documents: [
          { type: "VEHICLE_REGISTRATION", status: "APPROVED" },
          { type: "VEHICLE_INSURANCE", status: "PENDING" },
        ],
      },
      {
        id: "asset-2",
        verificationStatus: "APPROVED",
        verificationSubmittedAt: new Date("2026-08-19T00:00:00Z"),
        provider: { businessName: { en: "Wadi Trips", ar: "" } },
        vehicle: { make: "Nissan", model: "Patrol", modelYear: 2024, vehicleType: "FOUR_BY_FOUR" },
        documents: [
          { type: "VEHICLE_REGISTRATION", status: "PENDING" }, // renewed doc awaiting re-review
          { type: "VEHICLE_INSURANCE", status: "APPROVED" },
        ],
      },
    ]);
    const queue = await getVehicleReviewQueue();
    // The active queue includes both work kinds (never DRAFT work-in-progress).
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assetType: "VEHICLE",
          OR: [
            { verificationStatus: "SUBMITTED" },
            { verificationStatus: "APPROVED", documents: { some: { status: "PENDING", type: { in: ["VEHICLE_REGISTRATION", "VEHICLE_INSURANCE"] } } } },
          ],
        },
      }),
    );
    expect(queue[0]).toMatchObject({ id: "asset-1", kind: "INITIAL", make: "Toyota", requiredTotal: 2, requiredApproved: 1 });
    expect(queue[1]).toMatchObject({ id: "asset-2", kind: "REMEDIATION", make: "Nissan", requiredTotal: 2, requiredApproved: 1 });
  });

  it("requires an admin (gate is invoked)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "a1" } });
    findManyMock.mockResolvedValue([]);
    await getVehicleReviewQueue();
    expect(requireAdminMock).toHaveBeenCalled();
  });
});
