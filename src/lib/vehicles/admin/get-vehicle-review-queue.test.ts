import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
const requireAdminMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAdmin: (...a: unknown[]) => requireAdminMock(...a) }));
const findManyMock = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { asset: { findMany: (...a: unknown[]) => findManyMock(...a) } } }));

const { getVehicleReviewQueue } = await import("./get-vehicle-review-queue");

afterEach(() => vi.clearAllMocks());

describe("getVehicleReviewQueue", () => {
  it("queries only SUBMITTED vehicles and maps doc progress", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "a1" } });
    findManyMock.mockResolvedValue([
      {
        id: "asset-1",
        verificationSubmittedAt: new Date("2026-08-20T00:00:00Z"),
        provider: { businessName: { en: "Desert Tours", ar: "" } },
        vehicle: { make: "Toyota", model: "Land Cruiser", modelYear: 2025, vehicleType: "FOUR_BY_FOUR" },
        documents: [
          { type: "VEHICLE_REGISTRATION", status: "APPROVED" },
          { type: "VEHICLE_INSURANCE", status: "PENDING" },
        ],
      },
    ]);
    const queue = await getVehicleReviewQueue();
    // The active queue is scoped to SUBMITTED only (never DRAFT work-in-progress).
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { assetType: "VEHICLE", verificationStatus: "SUBMITTED" } }));
    expect(queue[0]).toMatchObject({ id: "asset-1", make: "Toyota", model: "Land Cruiser", requiredTotal: 2, requiredApproved: 1 });
  });

  it("requires an admin (gate is invoked)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "a1" } });
    findManyMock.mockResolvedValue([]);
    await getVehicleReviewQueue();
    expect(requireAdminMock).toHaveBeenCalled();
  });
});
