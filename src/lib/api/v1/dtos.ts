import type { ServiceListItem } from "@/lib/services/get-services";
import type { ServiceDetail, ActivePriceOption } from "@/lib/services/get-service-detail";
import type { ProviderProfile } from "@/lib/services/get-provider-profile";
import type { PublicRootCategory } from "@/lib/categories/get-public-root-categories";
import type { AvailableSlot } from "@/lib/booking/get-available-slots";
import type { MyBookingListItem } from "@/lib/booking/get-my-bookings";
import type { BookingDetail } from "@/lib/booking/get-booking-detail";
import type { BookingTimelineEntry } from "@/lib/booking/lifecycle/get-booking-timeline";
import type { NotificationListItem } from "@/lib/notifications/get-notifications";
import type { ProviderProfileForEdit } from "@/lib/provider/queries/get-provider-profile-for-edit";
import type { ProviderServiceListItem } from "@/lib/provider/queries/get-provider-services";
import type { ProviderServiceDetail } from "@/lib/provider/queries/get-provider-service-detail";
import type { ProviderAvailabilityListItem } from "@/lib/provider/queries/get-provider-availability";
import type { ProviderBookingListItem } from "@/lib/provider/queries/get-provider-bookings";
import type { ProviderBookingDetail } from "@/lib/provider/queries/get-provider-booking-detail";
import type { ProviderVerificationData } from "@/lib/provider/documents/get-provider-verification-data";
import type { Locale } from "@/i18n/locales";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { parseMoneyString, toMoneyDTO, type MoneyDTO } from "./money";

// API v1 public DTOs — Gate 1 (Public API Foundation).
//
// PURPOSE-BUILT, STABLE, camelCase DTOs — never raw Prisma models. Each mapper
// takes the EXISTING authoritative reader's return type (ServiceListItem,
// ServiceDetail, ProviderProfile, PublicRootCategory, AvailableSlot) and
// reshapes it for the wire: money → MoneyDTO (decimal string), Date → ISO-8601,
// and (critically) an ALLOW-LIST of fields so nothing internal can leak. The
// source readers already exclude sensitive fields (e.g. Provider.contactEmail is
// never on ProviderProfile; ProviderDocument/objectKey/authUserId never appear),
// and these mappers only ever copy the named public fields — no spread of the
// source object.

// ---------------------------------------------------------------------------
// Service summary (list cards)
// ---------------------------------------------------------------------------

export interface ServiceSummaryDTO {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  price: MoneyDTO | null;
  regionCode: string | null;
  pricingUnit: string | null;
  coverUrl: string | null;
  createdAt: string; // ISO-8601
}

export function toServiceSummaryDTO(item: ServiceListItem): ServiceSummaryDTO {
  return {
    id: item.id,
    name: item.name,
    providerId: item.providerId,
    providerName: item.providerName,
    price: parseMoneyString(item.price),
    regionCode: item.regionCode,
    pricingUnit: item.pricingUnit,
    coverUrl: item.coverUrl,
    createdAt: item.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Service detail
// ---------------------------------------------------------------------------

export interface ActivePriceDTO {
  id: string;
  price: MoneyDTO;
  /// BOOKING-PRICE-SEMANTICS — the governed CODE this amount is priced per, or null.
  /// Stable and never localized, so a client may branch on it.
  pricingUnit: string | null;
  /// The same unit already localized by the Platform, or null when there is none — or
  /// when the code is one the label registry does not yet know. A client renders the
  /// amount alone in that case and NEVER falls back to showing `pricingUnit` itself.
  ///
  /// Resolved server-side on purpose: the pricing-unit vocabulary is commercially
  /// extensible with no DB CHECK, so every client mirroring the registry would drift
  /// the moment a unit is added.
  pricingUnitLabel: string | null;
}

// TOUR-VEHICLE-3 — customer-semantic tour vehicle presentation. Deliberately NOT the pool
// row shape: no vehicleId/serviceId join metadata, no createdAt/isInPool, no blocker codes,
// no registrationNumber/documents/expiry/trusted-raw/admin fields — a native client receives
// only safe example-vehicle summaries (never an assigned/guaranteed vehicle).
export interface TourVehicleDTO {
  make: string | null;
  model: string | null;
  modelYear: number | null;
  color: string | null;
  passengerCapacity: number | null;
  vehicleType: string | null;
  isFourByFour: boolean;
}

export interface TourVehicleSummaryDTO {
  transportIncluded: boolean;
  requiresFourByFour: boolean;
  /** Only currently-eligible pooled vehicles; empty when a transport tour is temporarily degraded. */
  vehicles: TourVehicleDTO[];
}

export interface ServiceDetailDTO {
  id: string;
  name: string;
  description: string;
  providerId: string;
  providerName: string;
  providerDescription: string;
  /** Raw approval status (e.g. "APPROVED") — as already surfaced publicly by the web detail page. */
  providerStatus: string;
  /** Convenience flag derived from providerStatus === "APPROVED" (the public "Verified Provider" badge). */
  providerVerified: boolean;
  price: MoneyDTO | null;
  regionCode: string | null;
  pricingUnit: string | null;
  coverUrl: string | null;
  gallery: string[];
  activePrices: ActivePriceDTO[];
  ratingAverage: number | null;
  reviewCount: number;
  /** TOUR-VEHICLE-3 — present only for a tour with a vehicle presentation; null otherwise. */
  tourVehicleSummary: TourVehicleSummaryDTO | null;
  createdAt: string; // ISO-8601
}

export function toServiceDetailDTO(
  detail: ServiceDetail,
  activePrices: ActivePriceOption[],
  rating: { averageRating: number | null; reviewCount: number },
  tourVehicleSummary?: TourVehicleSummaryDTO | null
): ServiceDetailDTO {
  return {
    id: detail.id,
    name: detail.name,
    description: detail.description,
    providerId: detail.providerId,
    providerName: detail.providerName,
    providerDescription: detail.providerDescription,
    providerStatus: detail.providerStatus,
    providerVerified: detail.providerStatus === "APPROVED",
    price: parseMoneyString(detail.price),
    regionCode: detail.regionCode,
    pricingUnit: detail.pricingUnit,
    coverUrl: detail.coverUrl,
    gallery: detail.gallery,
    activePrices: activePrices.map((option) => ({
      id: option.id,
      price: toMoneyDTO(option.amount, option.currency),
      pricingUnit: option.pricingUnit,
      pricingUnitLabel: option.pricingUnitLabel,
    })),
    ratingAverage: rating.averageRating,
    reviewCount: rating.reviewCount,
    tourVehicleSummary: tourVehicleSummary ?? null,
    createdAt: detail.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Provider public profile
// ---------------------------------------------------------------------------

export interface ProviderCategoryDTO {
  id: string;
  slug: string;
  label: string;
}

export interface ProviderPublicDTO {
  id: string;
  name: string;
  description: string;
  status: string;
  providerType: string;
  /** Derived public "Verified Provider" flag (status === "APPROVED"). */
  verified: boolean;
  city: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  portfolio: string[];
  publishedServicesCount: number;
  averageRating: number | null;
  reviewCount: number;
  categories: ProviderCategoryDTO[];
}

export function toProviderPublicDTO(profile: ProviderProfile): ProviderPublicDTO {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    status: profile.status,
    providerType: profile.providerType,
    verified: profile.status === "APPROVED",
    city: profile.city,
    logoUrl: profile.logoUrl,
    coverUrl: profile.coverUrl,
    portfolio: profile.portfolio,
    publishedServicesCount: profile.publishedServicesCount,
    averageRating: profile.averageRating,
    reviewCount: profile.reviewCount,
    categories: profile.categories.map((chip) => ({
      id: chip.id,
      slug: chip.slug,
      label: chip.label,
    })),
  };
}

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------

export interface CategoryDTO {
  id: string;
  slug: string;
  label: string;
}

export function toCategoryDTO(category: PublicRootCategory): CategoryDTO {
  return { id: category.id, slug: category.slug, label: category.label };
}

// ---------------------------------------------------------------------------
// Availability slot
// ---------------------------------------------------------------------------

export interface AvailabilitySlotDTO {
  id: string;
  startTime: string; // ISO-8601
  endTime: string; // ISO-8601
  remainingSeats: number;
}

export function toAvailabilitySlotDTO(slot: AvailableSlot): AvailabilitySlotDTO {
  return {
    id: slot.id,
    startTime: slot.startTime.toISOString(),
    endTime: slot.endTime.toISOString(),
    remainingSeats: slot.remainingSeats,
  };
}

// ===========================================================================
// Gate 2 — Authenticated customer DTOs
// ===========================================================================

// ---------------------------------------------------------------------------
// Authenticated identity (/me)
// ---------------------------------------------------------------------------

// Provider state for /me — lets iOS decide the provider entry point (become /
// application-status / workspace) from ProviderStatus, without exposing any
// internal provider data. `status` is the raw ProviderStatus (APPLIED /
// UNDER_REVIEW / APPROVED / REJECTED / SUSPENDED / DEACTIVATED) or null when the
// user has no Provider record. `workspaceAvailable` is APPROVED-only.
export interface MeProviderDTO {
  exists: boolean;
  status: string | null;
  type: string | null;
  workspaceAvailable: boolean;
}

export interface MeDTO {
  id: string;
  name: string | null;
  phone: string | null;
  phoneVerified: boolean;
  locale: string;
  provider: MeProviderDTO;
}

// Minimal identity view. A User is the single account identity; Provider is an
// optional, additive capability on the same account (never a mutually exclusive
// role) — so provider is always present as an object with `exists`.
export function toMeDTO(
  user: { id: string; name: string | null; phoneNumber: string | null; phoneNumberVerified: boolean },
  provider: MeProviderDTO,
  locale: string
): MeDTO {
  return {
    id: user.id,
    name: user.name,
    phone: user.phoneNumber,
    phoneVerified: user.phoneNumberVerified,
    locale,
    provider,
  };
}

// ---------------------------------------------------------------------------
// Booking summary (customer's own list)
// ---------------------------------------------------------------------------

export interface BookingSummaryDTO {
  id: string;
  status: string;
  /// BOOKING-SUMMARY-RECONCILIATION — stable machine id of the booked service. Already
  /// public (it keys GET /api/v1/services/{id}) and already on BookingDetailDTO.
  serviceId: string;
  serviceName: string;
  // Snapshotted price captured at booking time (domain truth). This is the
  // stored Price snapshot, NOT a computed order total — labeled honestly so a
  // client never treats it as a seats-multiplied total.
  priceSnapshot: MoneyDTO | null;
  scheduledStartTime: string | null; // ISO-8601 slot start, when the booking references a slot
  /// BOOKING-SUMMARY-RECONCILIATION — the slot id, or null when the booking has no slot.
  ///
  /// THIS IS THE RECONCILIATION KEY, and it is exposed because nothing weaker works. A
  /// client that receives 422 DUPLICATE_BOOKING needs to find the booking that already
  /// exists WITHOUT guessing. createBooking()'s guard is
  /// `{ customerId, availabilityId, status: { not: "CANCELLED" } }`, so a client holding
  /// the availabilityId it just submitted reproduces that predicate exactly.
  ///
  /// serviceId + scheduledStartTime CANNOT substitute: Availability has no
  /// @@unique(serviceId, startTime), no unique/exclusion constraint in any migration,
  /// and none of the four availability write paths guards against overlap — so two rows
  /// may legitimately share a service and a start time, yielding two candidates.
  ///
  /// Not a new exposure: slot ids are already served unauthenticated by
  /// GET /api/v1/services/{id}/availability, and this endpoint only ever returns the
  /// caller's own bookings.
  availabilityId: string | null;
  createdAt: string; // ISO-8601
}

export function toBookingSummaryDTO(item: MyBookingListItem): BookingSummaryDTO {
  return {
    id: item.id,
    status: item.status,
    serviceId: item.serviceId,
    serviceName: item.serviceName,
    priceSnapshot: parseMoneyString(item.priceSnapshot),
    scheduledStartTime: item.slotStartTime ? item.slotStartTime.toISOString() : null,
    availabilityId: item.availabilityId,
    createdAt: item.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Assigned vehicle (BOOKING-VEHICLE-2) — the historical snapshot committed at
// provider acceptance. Customer gets the safe allowlist; provider additionally
// gets the ONE live operational field (registrationNumber). Explicit maps (never
// a pass-through of the stored value) keep the wire an allowlist by construction —
// no id, no assetId, no verification/documents/expiry/objectKey/pool metadata.
// ---------------------------------------------------------------------------

export interface AssignedVehicleDTO {
  make: string | null;
  model: string | null;
  modelYear: number | null;
  color: string | null;
  passengerCapacity: number | null;
  vehicleType: string | null;
  isFourByFour: boolean;
}

export interface ProviderAssignedVehicleDTO extends AssignedVehicleDTO {
  /** LIVE operational plate of the assigned Vehicle — provider-only, never sent to customers. */
  registrationNumber: string | null;
}

function toAssignedVehicleDTO(v: AssignedVehicleDTO | null): AssignedVehicleDTO | null {
  if (!v) return null;
  return {
    make: v.make,
    model: v.model,
    modelYear: v.modelYear,
    color: v.color,
    passengerCapacity: v.passengerCapacity,
    vehicleType: v.vehicleType,
    isFourByFour: v.isFourByFour,
  };
}

function toProviderAssignedVehicleDTO(v: ProviderAssignedVehicleDTO | null): ProviderAssignedVehicleDTO | null {
  if (!v) return null;
  return { ...toAssignedVehicleDTO(v)!, registrationNumber: v.registrationNumber };
}

// ---------------------------------------------------------------------------
// Booking detail (customer's own)
// ---------------------------------------------------------------------------

export interface BookingDetailDTO {
  id: string;
  status: string;
  serviceId: string;
  serviceName: string;
  providerId: string;
  providerName: string;
  seats: number;
  priceSnapshot: MoneyDTO | null; // stored snapshot (unit price at booking time), not a computed total
  scheduledStartTime: string | null; // ISO-8601
  confirmedAt: string | null; // ISO-8601
  createdAt: string; // ISO-8601
  hasReview: boolean;
  paymentId: string | null;
  // BOOKING-VEHICLE-2 — customer-safe historical assigned vehicle (snapshot only), or null.
  assignedVehicle: AssignedVehicleDTO | null;
}

export function toBookingDetailDTO(detail: BookingDetail): BookingDetailDTO {
  return {
    id: detail.id,
    status: detail.status,
    serviceId: detail.serviceId,
    serviceName: detail.serviceName,
    providerId: detail.providerId,
    providerName: detail.providerName,
    seats: detail.seats,
    priceSnapshot: parseMoneyString(detail.priceSnapshot),
    scheduledStartTime: detail.slotStartTime ? detail.slotStartTime.toISOString() : null,
    confirmedAt: detail.confirmedAt ? detail.confirmedAt.toISOString() : null,
    createdAt: detail.createdAt.toISOString(),
    hasReview: detail.hasReview,
    paymentId: detail.paymentId,
    assignedVehicle: toAssignedVehicleDTO(detail.assignedVehicle),
  };
}

// ---------------------------------------------------------------------------
// Notification
// ---------------------------------------------------------------------------

export interface NotificationDTO {
  id: string;
  message: string; // localized display text extracted from the notification content (never the raw JSON payload)
  kind: string | null; // stable notification kind, when present
  isRead: boolean;
  causingBookingId: string | null; // safe deep-link target, when present
  createdAt: string; // ISO-8601
}

export function toNotificationDTO(item: NotificationListItem): NotificationDTO {
  return {
    id: item.id,
    message: item.message,
    kind: item.kind ?? null,
    isRead: item.isRead,
    causingBookingId: item.causingBookingId,
    createdAt: item.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Booking timeline event (Gate 3)
// ---------------------------------------------------------------------------

// Maps the existing BookingTimelineEntry, which is ALREADY actorId-free by
// design (get-booking-timeline.ts deliberately excludes the raw actorId /
// internal User id). Exposes only status transition + actorType + optional
// reason + timestamp.
export interface BookingTimelineEventDTO {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  actorType: string;
  reason: string | null;
  occurredAt: string; // ISO-8601
}

export function toBookingTimelineEventDTO(entry: BookingTimelineEntry): BookingTimelineEventDTO {
  return {
    id: entry.id,
    fromStatus: entry.fromStatus,
    toStatus: entry.toStatus,
    actorType: entry.actorType,
    reason: entry.reason,
    occurredAt: entry.occurredAt.toISOString(),
  };
}

// ===========================================================================
// Gate PB — Provider read DTOs (allow-list; money as string; ISO dates; never
// exposes userId/authUserId, approvedByAdminId/rejectedByAdminId, ProviderDocument
// objectKey/versionToken, storage internals, or customer PII)
// ===========================================================================

// Provider workspace state (/me/provider) — works for a user with no provider
// (exists:false), so it never 403s. verified/workspaceAvailable derive from
// status === "APPROVED".
export interface ProviderWorkspaceStateDTO {
  exists: boolean;
  id: string | null;
  status: string | null;
  type: string | null;
  visible: boolean | null;
  workspaceAvailable: boolean;
  verified: boolean;
}

export function toProviderWorkspaceStateDTO(
  provider: { id: string; status: string; providerType: string; visible: boolean } | null
): ProviderWorkspaceStateDTO {
  if (!provider) {
    return { exists: false, id: null, status: null, type: null, visible: null, workspaceAvailable: false, verified: false };
  }
  const approved = provider.status === "APPROVED";
  return {
    exists: true,
    id: provider.id,
    status: provider.status,
    type: provider.providerType,
    visible: provider.visible,
    workspaceAvailable: approved,
    verified: approved,
  };
}

// Provider self-profile (/me/provider/profile). contactEmail is the provider's
// OWN business email — safe in this SELF view (BR-002 forbids exposing it to
// TOURISTS, not to the provider) and never in the public ProviderPublicDTO.
export interface ProviderProfileDTO {
  id: string;
  businessName: { ar: string; en: string };
  businessDescription: { ar: string; en: string };
  providerType: string;
  city: string | null;
  contactEmail: string | null;
  logoUrl: string | null;
}

export function toProviderProfileDTO(p: ProviderProfileForEdit): ProviderProfileDTO {
  return {
    id: p.id,
    businessName: { ar: p.businessNameAr, en: p.businessNameEn },
    businessDescription: { ar: p.businessDescriptionAr, en: p.businessDescriptionEn },
    providerType: p.providerType,
    city: p.city || null,
    contactEmail: p.contactEmail || null,
    logoUrl: p.logoUrl || null,
  };
}

// Provider services (own catalog — all statuses).
export interface ProviderServiceListItemDTO {
  id: string;
  name: string;
  status: string;
  price: MoneyDTO | null;
  hasNoUpcomingAvailability: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toProviderServiceListItemDTO(item: ProviderServiceListItem): ProviderServiceListItemDTO {
  return {
    id: item.id,
    name: item.name,
    status: item.status,
    price: parseMoneyString(item.price),
    hasNoUpcomingAvailability: item.hasNoUpcomingAvailability,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export interface ProviderServiceDetailDTO {
  id: string;
  name: string;
  description: string;
  status: string;
  price: MoneyDTO | null;
  createdAt: string;
  updatedAt: string;
}

export function toProviderServiceDetailDTO(detail: ProviderServiceDetail): ProviderServiceDetailDTO {
  return {
    id: detail.id,
    name: detail.name,
    description: detail.description,
    status: detail.status,
    price: detail.priceAmount && detail.priceCurrency ? toMoneyDTO(detail.priceAmount, detail.priceCurrency) : null,
    createdAt: detail.createdAt.toISOString(),
    updatedAt: detail.updatedAt.toISOString(),
  };
}

// Provider availability (own slots). Exposes capacity + remainingSeats; the raw
// bookedCount concurrency counter is intentionally omitted (derivable as
// capacity - remainingSeats).
export interface ProviderAvailabilitySlotDTO {
  id: string;
  serviceId: string;
  serviceName: string;
  startTime: string;
  endTime: string;
  state: string;
  capacity: number;
  remainingSeats: number;
}

export function toProviderAvailabilitySlotDTO(slot: ProviderAvailabilityListItem): ProviderAvailabilitySlotDTO {
  return {
    id: slot.id,
    serviceId: slot.serviceId,
    serviceName: slot.serviceName,
    startTime: slot.startTime.toISOString(),
    endTime: slot.endTime.toISOString(),
    state: slot.state,
    capacity: slot.capacity,
    remainingSeats: slot.remainingSeats,
  };
}

// Provider incoming bookings. NO customer PII (none exists in the schema/reader).
export interface ProviderBookingListItemDTO {
  id: string;
  serviceName: string;
  status: string;
  seats: number;
  priceSnapshot: MoneyDTO | null;
  scheduledStartTime: string | null;
  availabilityId: string | null;
  createdAt: string;
}

export function toProviderBookingListItemDTO(item: ProviderBookingListItem): ProviderBookingListItemDTO {
  return {
    id: item.id,
    serviceName: item.serviceName,
    status: item.status,
    seats: item.seats,
    priceSnapshot: parseMoneyString(item.priceSnapshot),
    scheduledStartTime: item.slotStartTime ? item.slotStartTime.toISOString() : null,
    availabilityId: item.availabilityId,
    createdAt: item.createdAt.toISOString(),
  };
}

export interface ProviderBookingDetailDTO {
  id: string;
  serviceId: string;
  serviceName: string;
  status: string;
  seats: number;
  priceSnapshot: MoneyDTO | null;
  scheduledStartTime: string | null;
  createdAt: string;
  // BOOKING-VEHICLE-2 — historical snapshot fields + the ONE live plate; null when unassigned.
  assignedVehicle: ProviderAssignedVehicleDTO | null;
}

export function toProviderBookingDetailDTO(detail: ProviderBookingDetail): ProviderBookingDetailDTO {
  return {
    id: detail.id,
    serviceId: detail.serviceId,
    serviceName: detail.serviceName,
    status: detail.status,
    seats: detail.seats,
    priceSnapshot: parseMoneyString(detail.priceSnapshot),
    scheduledStartTime: detail.slotStartTime ? detail.slotStartTime.toISOString() : null,
    createdAt: detail.createdAt.toISOString(),
    assignedVehicle: toProviderAssignedVehicleDTO(detail.assignedVehicle),
  };
}

// Provider verification status. Requirement name/description localized to the
// request locale. The per-document shape exposes only status/filename/size/
// rejectionReason — NEVER objectKey, signed URL, versionToken (a mutation
// concern, PC), or the admin reviewer id.
export interface ProviderVerificationRequirementDTO {
  type: string;
  required: boolean;
  name: string;
  description: string | null;
  document: {
    id: string;
    status: string;
    originalFilename: string;
    sizeBytes: number;
    rejectionReason: string | null;
  } | null;
}

export interface ProviderVerificationDTO {
  providerStatus: string;
  providerType: string;
  storageAvailable: boolean;
  workspaceAvailable: boolean;
  requiredTotal: number;
  requiredApproved: number;
  canProgress: boolean;
  items: ProviderVerificationRequirementDTO[];
}

export function toProviderVerificationDTO(data: ProviderVerificationData, locale: Locale): ProviderVerificationDTO {
  return {
    providerStatus: data.providerStatus,
    providerType: data.providerType,
    storageAvailable: data.storageAvailable,
    workspaceAvailable: data.providerStatus === "APPROVED",
    requiredTotal: data.requiredTotal,
    requiredApproved: data.requiredApproved,
    canProgress: data.requiredTotal === data.requiredApproved,
    items: data.items.map((it) => ({
      type: it.type,
      required: it.required,
      name: extractLocalizedText(it.name, locale),
      description: it.description ? extractLocalizedText(it.description, locale) || null : null,
      document: it.document
        ? {
            id: it.document.id,
            status: it.document.status,
            originalFilename: it.document.originalFilename,
            sizeBytes: it.document.sizeBytes,
            rejectionReason: it.document.rejectionReason,
          }
        : null,
    })),
  };
}
