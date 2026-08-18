// Smart Tour-Guide Template — the sanitized guide-profile summary shape (TOUR-2).
// Pure type module so both the server reader and the client section share it
// without a client<->server import. Contains ONLY safe, already-public
// presentation data reused from the Provider profile — never verification docs,
// ID numbers, private phone/email, or admin internals.

export type GuideProfileSummary = {
  name: string;
  logoUrl: string | null;
  city: string | null;
  averageRating: number | null;
  reviewCount: number;
  isApproved: boolean;
  activityLabel: string | null;
};
