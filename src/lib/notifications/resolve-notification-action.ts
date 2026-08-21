// Gate B3 — the ONE pure, allowlisted resolver that turns a notification's
// structured metadata (eventType + entityType + entityId) into a SAFE internal
// CTA. It is deliberately a plain module (no "server-only", no prisma, no I/O) so
// the client bell and the server pages share exactly one mapping.
//
// SECURITY (open-redirect-safe by construction):
//   - The destination is NEVER read from the DB and NEVER supplied by a caller;
//     it comes ONLY from this fixed per-eventType allowlist.
//   - Routing is keyed on eventType (which carries a fixed audience) — an ADMIN
//     event resolves ONLY to an /admin route and a PROVIDER event ONLY to a
//     provider route, so entityType="Provider" alone can never decide the route.
//   - The only interpolated value (admin events' providerId) is validated as a
//     strict UUID before it is placed into `/admin/providers/<id>`, so no path
//     traversal / injection is possible. Even a mis-addressed CTA is harmless:
//     every destination page still enforces its own requireAdmin()/requireProvider().
//   - Returned `href` is a locale-AGNOSTIC internal path; the caller renders it
//     through the localized <Link> (which prefixes the active locale). It is never
//     an absolute/external URL.
//   - An unknown/legacy event (or a required-but-invalid entity) returns null —
//     the notification still renders as plain, readable text with no CTA.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The exact CTA label keys (all present in the "notifications" i18n namespace).
export type NotificationActionLabelKey =
  | "ctaReviewApplication"
  | "ctaReviewDocument"
  | "ctaBrowseWorkspace"
  | "ctaReviewChanges"
  | "ctaViewApplicationStatus"
  | "ctaViewBooking"
  | "ctaViewVehicle";

export type NotificationAction = {
  /// i18n key in the "notifications" namespace (rendered by the caller's translator).
  labelKey: NotificationActionLabelKey;
  /// Locale-agnostic INTERNAL path (no locale prefix, never external).
  href: string;
};

type ActionDef =
  | { labelKey: NotificationActionLabelKey; kind: "adminProviderDetail" } // interpolates a validated providerId
  | { labelKey: NotificationActionLabelKey; kind: "providerBookingDetail" } // interpolates a validated bookingId
  | { labelKey: NotificationActionLabelKey; kind: "providerVehicleDetail" } // interpolates a validated vehicleId (assetId)
  | { labelKey: NotificationActionLabelKey; kind: "fixed"; href: string }; // no interpolation

// The complete allowlist. Admin events -> the per-provider admin workspace
// (Gate A keeps admins inside the backoffice). Provider events -> the canonical,
// self-scoped provider routes (verified to exist: /provider, /provider/verification,
// /provider-application).
const ACTION_BY_EVENT: Record<string, ActionDef> = {
  // ---- ADMIN audience ----
  "provider.verification_submitted": { labelKey: "ctaReviewApplication", kind: "adminProviderDetail" },
  "provider.changes_resubmitted": { labelKey: "ctaReviewApplication", kind: "adminProviderDetail" },
  "provider.document_uploaded": { labelKey: "ctaReviewDocument", kind: "adminProviderDetail" },
  "provider.document_replaced": { labelKey: "ctaReviewDocument", kind: "adminProviderDetail" },
  // ---- PROVIDER audience ----
  "provider.approved": { labelKey: "ctaBrowseWorkspace", kind: "fixed", href: "/provider" },
  // Gate B4 — activity governance events route to the provider workspace.
  "provider.activity_granted": { labelKey: "ctaBrowseWorkspace", kind: "fixed", href: "/provider" },
  "provider.activity_revoked": { labelKey: "ctaBrowseWorkspace", kind: "fixed", href: "/provider" },
  "provider.changes_requested": { labelKey: "ctaReviewChanges", kind: "fixed", href: "/provider/verification" },
  "provider.document_rejected": { labelKey: "ctaReviewDocument", kind: "fixed", href: "/provider/verification" },
  "provider.rejected": { labelKey: "ctaViewApplicationStatus", kind: "fixed", href: "/provider-application" },
  // TOUR-2.5A1 — the existing PENDING_PROVIDER booking-lifecycle notification
  // (fired once, post-commit, on booking creation) becomes actionable. PROVIDER
  // audience: resolves ONLY to the provider's own booking-detail route with a
  // strict-UUID-validated bookingId — never an admin or customer route.
  "booking.created": { labelKey: "ctaViewBooking", kind: "providerBookingDetail" },
  // VEHICLE-LC4 — provider vehicle verification events resolve ONLY to the provider's
  // own /provider/vehicles/[id] workspace (strict-UUID-validated assetId). Never an
  // admin route, public vehicle page, signed document URL, or storage URL.
  "vehicle.changes_requested": { labelKey: "ctaReviewChanges", kind: "providerVehicleDetail" },
  "vehicle.verification_rejected": { labelKey: "ctaViewVehicle", kind: "providerVehicleDetail" },
  "vehicle.verification_approved": { labelKey: "ctaViewVehicle", kind: "providerVehicleDetail" },
  "vehicle.document_rejected": { labelKey: "ctaReviewDocument", kind: "providerVehicleDetail" },
  // VEHICLE-LC7 — operational activation resolves to the provider's own vehicle workspace.
  "vehicle.activated": { labelKey: "ctaViewVehicle", kind: "providerVehicleDetail" },
};

export function resolveNotificationAction(input: {
  eventType: string | null;
  entityType: string | null;
  entityId: string | null;
}): NotificationAction | null {
  const { eventType, entityType, entityId } = input;
  if (!eventType) return null;
  const def = ACTION_BY_EVENT[eventType];
  if (!def) return null;

  if (def.kind === "adminProviderDetail") {
    // Admin events target a specific Provider: require the EXACT entityType and a
    // strict UUID before interpolating — otherwise no CTA (never an unsafe route).
    if (entityType !== "Provider" || !entityId || !UUID_RE.test(entityId)) return null;
    return { labelKey: def.labelKey, href: `/admin/providers/${entityId}` };
  }

  if (def.kind === "providerBookingDetail") {
    // Provider audience: require entityType="Booking" + a strict UUID before
    // interpolating into the provider's own booking-detail route. A malformed or
    // wrong-typed entity yields no CTA (the notification still renders as text).
    if (entityType !== "Booking" || !entityId || !UUID_RE.test(entityId)) return null;
    return { labelKey: def.labelKey, href: `/provider/bookings/${entityId}` };
  }

  if (def.kind === "providerVehicleDetail") {
    // Provider audience: require entityType="Vehicle" + a strict UUID before
    // interpolating into the provider's own vehicle-detail route. Wrong-typed or
    // malformed entity yields no CTA. Never an admin/public/storage URL.
    if (entityType !== "Vehicle" || !entityId || !UUID_RE.test(entityId)) return null;
    return { labelKey: def.labelKey, href: `/provider/vehicles/${entityId}` };
  }

  // Fixed, self-scoped provider route — no interpolation, no entity trust needed.
  return { labelKey: def.labelKey, href: def.href };
}
