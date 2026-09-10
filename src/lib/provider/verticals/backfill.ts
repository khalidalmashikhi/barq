import type { OfferingKind, ProviderVerticalOrigin, ProviderVerticalStatus, ProviderVerticalType } from "@prisma/client";

// Phase 3B — Phase 1. Provider-vertical BACKFILL core (pure, dependency-injected, dry-run aware).
//
// Runs once at cutover. It is ADDITIVE and IDEMPOTENT (a second run is a no-op) and NEVER
// auto-approves a regulated vertical. It handles BOTH regulated segments symmetrically:
//   • VEHICLE_RENTAL  — identified by serviceType === "RENTAL"
//   • TOUR            — identified by membership in the verified tourist-guide category (only when
//                       its id is supplied; absent → tours are skipped, never guessed)
//
// For each segment, three steps in order:
//   1. offeringKind      — classify not-yet-classified services (offeringKind null) with the kind.
//                          EXPERIENCE and every non-matching type stay null; a guided TOUR is only
//                          the tourist-guide category, never inferred from a plain EXPERIENCE.
//   2. legacyVerticalExempt — grandfather ONLY services that were BOTH already PUBLISHED AND created
//                          BEFORE the immutable cutover boundary. A service created AFTER cutover can
//                          NEVER be grandfathered by a (possibly repeated) backfill run — it must go
//                          through vertical approval like any new listing.
//   3. candidate verticals — for every provider already operating a service in the segment, create a
//                          PENDING_REVIEW / LEGACY_BACKFILL vertical if absent. Derived from real
//                          service data, NEVER from category grants, and NEVER approved.

const RENTAL_OFFERING_KIND: OfferingKind = "VEHICLE_RENTAL";
const TOUR_OFFERING_KIND: OfferingKind = "TOUR";
const BACKFILL_STATUS: ProviderVerticalStatus = "PENDING_REVIEW";
const BACKFILL_ORIGIN: ProviderVerticalOrigin = "LEGACY_BACKFILL";

export interface BackfillPrisma {
  service: {
    count(args: unknown): Promise<number>;
    updateMany(args: unknown): Promise<{ count: number }>;
    findMany(args: unknown): Promise<{ providerId: string }[]>;
  };
  providerVertical: {
    findMany(args: unknown): Promise<{ providerId: string }[]>;
    createMany(args: unknown): Promise<{ count: number }>;
  };
}

export interface BackfillSegmentReport {
  vertical: ProviderVerticalType;
  offeringKind: OfferingKind;
  offeringKindClassified: number; // services that got (or would get) this offeringKind
  legacyExemptGrandfathered: number; // pre-cutover PUBLISHED services marked legacyVerticalExempt
  candidateVerticalsCreated: number; // PENDING_REVIEW / LEGACY_BACKFILL rows created
  providersWithListings: number; // distinct providers operating a listing in this segment
}

export interface BackfillReport {
  apply: boolean;
  cutoverAt: string; // ISO — the immutable grandfathering boundary actually used
  segments: BackfillSegmentReport[];
}

// A regulated segment: which services belong to it (`serviceWhere`), the kind to stamp, and the
// vertical to seed. `serviceWhere` is expressed WITHOUT offeringKind so dry-run counts match apply
// (step 1 has not yet written offeringKind on a first run).
type Segment = {
  vertical: ProviderVerticalType;
  offeringKind: OfferingKind;
  serviceWhere: Record<string, unknown>;
};

async function runSegment(
  prisma: BackfillPrisma,
  segment: Segment,
  opts: { apply: boolean; cutoverAt: Date }
): Promise<BackfillSegmentReport> {
  const { apply, cutoverAt } = opts;
  const { vertical, offeringKind, serviceWhere } = segment;

  // ── Step 1: classify not-yet-classified services (offeringKind null) with the kind (idempotent).
  const classifyTarget = { ...serviceWhere, offeringKind: null };
  const offeringKindClassified = await prisma.service.count({ where: classifyTarget });
  if (apply && offeringKindClassified > 0) {
    await prisma.service.updateMany({ where: classifyTarget, data: { offeringKind } });
  }

  // ── Step 2: grandfather services that were BOTH PUBLISHED AND created before the cutover boundary.
  const exemptTarget = { ...serviceWhere, status: "PUBLISHED", legacyVerticalExempt: false, createdAt: { lt: cutoverAt } };
  const legacyExemptGrandfathered = await prisma.service.count({ where: exemptTarget });
  if (apply && legacyExemptGrandfathered > 0) {
    await prisma.service.updateMany({ where: exemptTarget, data: { legacyVerticalExempt: true } });
  }

  // ── Step 3: create PENDING_REVIEW candidate verticals for providers already operating this segment.
  const segmentProviders = await prisma.service.findMany({
    where: serviceWhere,
    select: { providerId: true },
    distinct: ["providerId"],
  });
  const providerIds = [...new Set(segmentProviders.map((s) => s.providerId))];

  const existing = providerIds.length
    ? await prisma.providerVertical.findMany({
        where: { vertical, providerId: { in: providerIds } },
        select: { providerId: true },
      })
    : [];
  const existingIds = new Set(existing.map((v) => v.providerId));
  const toCreate = providerIds.filter((id) => !existingIds.has(id));

  if (apply && toCreate.length > 0) {
    await prisma.providerVertical.createMany({
      data: toCreate.map((providerId) => ({ providerId, vertical, status: BACKFILL_STATUS, origin: BACKFILL_ORIGIN })),
      skipDuplicates: true,
    });
  }

  return {
    vertical,
    offeringKind,
    offeringKindClassified,
    legacyExemptGrandfathered,
    candidateVerticalsCreated: toCreate.length,
    providersWithListings: providerIds.length,
  };
}

export async function runProviderVerticalBackfill(
  prisma: BackfillPrisma,
  options: { apply: boolean; cutoverAt: Date; touristGuideCategoryId?: string | null }
): Promise<BackfillReport> {
  const { apply, cutoverAt, touristGuideCategoryId = null } = options;

  const segments: Segment[] = [
    { vertical: "RENTAL_COMPANY", offeringKind: RENTAL_OFFERING_KIND, serviceWhere: { serviceType: "RENTAL" } },
  ];
  // TOUR is handled ONLY when the verified tourist-guide category id is supplied — never guessed.
  if (touristGuideCategoryId) {
    segments.push({ vertical: "TOURIST_GUIDE", offeringKind: TOUR_OFFERING_KIND, serviceWhere: { categoryId: touristGuideCategoryId } });
  }

  const reports: BackfillSegmentReport[] = [];
  for (const segment of segments) {
    reports.push(await runSegment(prisma, segment, { apply, cutoverAt }));
  }

  return { apply, cutoverAt: cutoverAt.toISOString(), segments: reports };
}
