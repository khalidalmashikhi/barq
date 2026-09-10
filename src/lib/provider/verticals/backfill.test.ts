import { describe, it, expect, vi } from "vitest";
import { runProviderVerticalBackfill, type BackfillPrisma } from "./backfill";

// Phase 3B — Phase 1. Backfill core: additive, idempotent, never auto-approves, and grandfathers
// ONLY services published before an immutable cutover boundary. Handles the RENTAL segment always
// and the TOUR segment only when the tourist-guide category id is supplied.

const CUTOVER = new Date("2026-09-10T12:00:00.000Z");

// service.count is called twice PER SEGMENT (step 1 classify, then step 2 grandfather), in order.
function makePrisma(opts: {
  counts: number[]; // [rentalClassify, rentalExempt, (tourClassify, tourExempt)?]
  rentalProviders?: { providerId: string }[];
  tourProviders?: { providerId: string }[];
  existingRental?: { providerId: string }[];
  existingTour?: { providerId: string }[];
}): BackfillPrisma & {
  serviceUpdateMany: ReturnType<typeof vi.fn>;
  verticalCreateMany: ReturnType<typeof vi.fn>;
  serviceCount: ReturnType<typeof vi.fn>;
} {
  const serviceCount = vi.fn();
  for (const c of opts.counts) serviceCount.mockResolvedValueOnce(c);
  const serviceUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
  // findMany(services) returns providers per segment: RENTAL query has where.serviceType, TOUR has where.categoryId.
  const serviceFindMany = vi.fn().mockImplementation((args: { where?: Record<string, unknown> }) => {
    if (args?.where && "categoryId" in args.where) return Promise.resolve(opts.tourProviders ?? []);
    return Promise.resolve(opts.rentalProviders ?? []);
  });
  const verticalFindMany = vi.fn().mockImplementation((args: { where?: { vertical?: string } }) => {
    return Promise.resolve(args?.where?.vertical === "TOURIST_GUIDE" ? (opts.existingTour ?? []) : (opts.existingRental ?? []));
  });
  const verticalCreateMany = vi.fn().mockResolvedValue({ count: 0 });
  return {
    service: { count: serviceCount, updateMany: serviceUpdateMany, findMany: serviceFindMany },
    providerVertical: { findMany: verticalFindMany, createMany: verticalCreateMany },
    serviceUpdateMany,
    verticalCreateMany,
    serviceCount,
  };
}

describe("runProviderVerticalBackfill — rental segment", () => {
  it("DRY-RUN reports the plan and writes NOTHING", async () => {
    const prisma = makePrisma({
      counts: [3, 2],
      rentalProviders: [{ providerId: "p1" }, { providerId: "p2" }],
      existingRental: [{ providerId: "p1" }],
    });
    const report = await runProviderVerticalBackfill(prisma, { apply: false, cutoverAt: CUTOVER });

    expect(report.segments).toHaveLength(1);
    expect(report.segments[0]).toMatchObject({
      vertical: "RENTAL_COMPANY",
      offeringKind: "VEHICLE_RENTAL",
      offeringKindClassified: 3,
      legacyExemptGrandfathered: 2,
      candidateVerticalsCreated: 1, // p2 only
      providersWithListings: 2,
    });
    expect(prisma.serviceUpdateMany).not.toHaveBeenCalled();
    expect(prisma.verticalCreateMany).not.toHaveBeenCalled();
  });

  it("APPLY classifies RENTAL→VEHICLE_RENTAL and grandfathers ONLY pre-cutover PUBLISHED via createdAt boundary", async () => {
    const prisma = makePrisma({
      counts: [3, 2],
      rentalProviders: [{ providerId: "p1" }, { providerId: "p2" }],
      existingRental: [{ providerId: "p1" }],
    });
    await runProviderVerticalBackfill(prisma, { apply: true, cutoverAt: CUTOVER });

    expect(prisma.serviceUpdateMany).toHaveBeenCalledWith({
      where: { serviceType: "RENTAL", offeringKind: null },
      data: { offeringKind: "VEHICLE_RENTAL" },
    });
    // The grandfathering target is BOUNDED by createdAt < cutover — a post-cutover service is excluded.
    expect(prisma.serviceUpdateMany).toHaveBeenCalledWith({
      where: { serviceType: "RENTAL", status: "PUBLISHED", legacyVerticalExempt: false, createdAt: { lt: CUTOVER } },
      data: { legacyVerticalExempt: true },
    });
    expect(prisma.verticalCreateMany).toHaveBeenCalledWith({
      data: [{ providerId: "p2", vertical: "RENTAL_COMPANY", status: "PENDING_REVIEW", origin: "LEGACY_BACKFILL" }],
      skipDuplicates: true,
    });
  });

  it("is IDEMPOTENT: a second run (nothing to classify/grandfather, all verticals present) writes nothing", async () => {
    const prisma = makePrisma({ counts: [0, 0], rentalProviders: [{ providerId: "p1" }], existingRental: [{ providerId: "p1" }] });
    await runProviderVerticalBackfill(prisma, { apply: true, cutoverAt: CUTOVER });
    expect(prisma.serviceUpdateMany).not.toHaveBeenCalled();
    expect(prisma.verticalCreateMany).not.toHaveBeenCalled();
  });
});

describe("runProviderVerticalBackfill — tour segment", () => {
  it("SKIPS the tour segment entirely when no tourist-guide category id is supplied", async () => {
    const prisma = makePrisma({ counts: [0, 0] });
    const report = await runProviderVerticalBackfill(prisma, { apply: true, cutoverAt: CUTOVER });
    expect(report.segments).toHaveLength(1);
    expect(report.segments.some((s) => s.vertical === "TOURIST_GUIDE")).toBe(false);
  });

  it("handles the tour segment (classify TOUR by category, grandfather pre-cutover, candidate TOURIST_GUIDE) when the id is supplied", async () => {
    const prisma = makePrisma({
      counts: [0, 0, 2, 1], // rental classify/exempt = 0/0, tour classify/exempt = 2/1
      rentalProviders: [],
      tourProviders: [{ providerId: "g1" }],
      existingTour: [],
    });
    const report = await runProviderVerticalBackfill(prisma, { apply: true, cutoverAt: CUTOVER, touristGuideCategoryId: "tg-cat" });

    expect(report.segments).toHaveLength(2);
    const tour = report.segments.find((s) => s.vertical === "TOURIST_GUIDE")!;
    expect(tour).toMatchObject({ offeringKind: "TOUR", offeringKindClassified: 2, legacyExemptGrandfathered: 1, candidateVerticalsCreated: 1 });
    // Classify by the tourist-guide CATEGORY, not a serviceType (never mislabels EXPERIENCE broadly).
    expect(prisma.serviceUpdateMany).toHaveBeenCalledWith({
      where: { categoryId: "tg-cat", offeringKind: null },
      data: { offeringKind: "TOUR" },
    });
    expect(prisma.serviceUpdateMany).toHaveBeenCalledWith({
      where: { categoryId: "tg-cat", status: "PUBLISHED", legacyVerticalExempt: false, createdAt: { lt: CUTOVER } },
      data: { legacyVerticalExempt: true },
    });
    expect(prisma.verticalCreateMany).toHaveBeenCalledWith({
      data: [{ providerId: "g1", vertical: "TOURIST_GUIDE", status: "PENDING_REVIEW", origin: "LEGACY_BACKFILL" }],
      skipDuplicates: true,
    });
  });
});
