import type { ServiceListItem } from "@/lib/services/get-services";
import type { ServiceDetail, ActivePriceOption } from "@/lib/services/get-service-detail";
import type { ProviderProfile } from "@/lib/services/get-provider-profile";
import type { PublicRootCategory } from "@/lib/categories/get-public-root-categories";
import type { AvailableSlot } from "@/lib/booking/get-available-slots";
import type { MyBookingListItem } from "@/lib/booking/get-my-bookings";
import type { BookingDetail } from "@/lib/booking/get-booking-detail";
import type { NotificationListItem } from "@/lib/notifications/get-notifications";
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
  createdAt: string; // ISO-8601
}

export function toServiceDetailDTO(
  detail: ServiceDetail,
  activePrices: ActivePriceOption[],
  rating: { averageRating: number | null; reviewCount: number }
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
    })),
    ratingAverage: rating.averageRating,
    reviewCount: rating.reviewCount,
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
  serviceName: string;
  // Snapshotted price captured at booking time (domain truth). This is the
  // stored Price snapshot, NOT a computed order total — labeled honestly so a
  // client never treats it as a seats-multiplied total.
  priceSnapshot: MoneyDTO | null;
  scheduledStartTime: string | null; // ISO-8601 slot start, when the booking references a slot
  createdAt: string; // ISO-8601
}

export function toBookingSummaryDTO(item: MyBookingListItem): BookingSummaryDTO {
  return {
    id: item.id,
    status: item.status,
    serviceName: item.serviceName,
    priceSnapshot: parseMoneyString(item.priceSnapshot),
    scheduledStartTime: item.slotStartTime ? item.slotStartTime.toISOString() : null,
    createdAt: item.createdAt.toISOString(),
  };
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
