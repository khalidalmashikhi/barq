import "server-only";
import { prisma } from "@/lib/db";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import type { Locale } from "@/i18n/locales";
import type { ProviderCategorySource } from "@prisma/client";

// Gate B4 — the authorized-activity reader, grouped by provenance. One query,
// resolved to locale labels, for BOTH the admin provider-detail workspace and the
// provider's own read-only "My activities" view. Never filters by source — a
// provider's authorized set is SELF ∪ ADMIN ∪ LEGACY (all preserved & authorized).

export type ProviderActivity = {
  categoryId: string;
  label: string;
  source: ProviderCategorySource;
  isPrimary: boolean;
  grantedAt: Date | null;
};

export type ProviderActivities = {
  /// The single self-selected primary (source=SELF, isPrimary=true). null if the
  /// provider has not chosen one yet (e.g. a fresh DRAFT, or a zero-category legacy row).
  primary: ProviderActivity | null;
  /// Admin-granted additional activities (source=ADMIN), never primary.
  adminGranted: ProviderActivity[];
  /// Pre-provenance links preserved from before Gate B (source=LEGACY), authorized.
  legacy: ProviderActivity[];
};

export async function getProviderActivities(providerId: string, locale: Locale): Promise<ProviderActivities> {
  const rows = await prisma.providerCategory.findMany({
    where: { providerId },
    select: {
      categoryId: true,
      source: true,
      isPrimary: true,
      grantedAt: true,
      category: { select: { name: true, slug: true } },
    },
    orderBy: { category: { sortOrder: "asc" } },
  });

  const toActivity = (r: (typeof rows)[number]): ProviderActivity => ({
    categoryId: r.categoryId,
    label: extractLocalizedText(r.category.name, locale) || r.category.slug,
    source: r.source,
    isPrimary: r.isPrimary,
    grantedAt: r.grantedAt,
  });

  return {
    primary: rows.filter((r) => r.source === "SELF" && r.isPrimary).map(toActivity)[0] ?? null,
    adminGranted: rows.filter((r) => r.source === "ADMIN").map(toActivity),
    legacy: rows.filter((r) => r.source === "LEGACY").map(toActivity),
  };
}
