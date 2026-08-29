import { NextResponse } from "next/server";
import { defaultLocale, type Locale } from "@/i18n/locales";

// API v1 error envelope — Gate 1 (Public API Foundation).
//
// ONE reusable envelope for the whole `/api/v1` surface:
//   { "error": { "code", "message", "details"?, "retryAfterSeconds"? } }
// Optional fields are included only when relevant. Messages are safe and
// localized (ar/en filled for the Gate-1 codes; other BARQ locales fall back to
// English until a later gate wires the full `errors` message namespace here).
//
// NEVER leaks stack traces, Prisma errors, DB URLs, secrets, or session/auth
// tokens — the envelope only ever emits a stable machine code plus a curated,
// human-safe message string. Domain error semantics are unchanged; this module
// only maps them to HTTP + a wire shape.

export type ApiErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  // Gate PB (Provider Read API) — provider-authentication rejection codes.
  | "NO_PROVIDER_PROFILE"
  | "PROVIDER_NOT_APPROVED"
  // Gate 3 (Booking Mutations) — booking-domain rejection codes. These carry the
  // EXISTING BookingActionErrorCode meanings onto the wire unchanged (mapped in
  // src/lib/api/v1/booking-errors.ts); ar/en messages mirror messages/*/errors.json.
  | "NO_CUSTOMER_PROFILE"
  // PLATFORM-BOOKING-INCOMPLETE-ERROR-1 — the customer has not completed dual
  // verification (a verified phone AND a real verified email). Distinct from
  // NO_CUSTOMER_PROFILE, which means there is no Customer row at all. This gate makes
  // the refusal READABLE; the API remedy for satisfying it is a separate gate.
  | "CUSTOMER_INCOMPLETE"
  | "NOT_FOUND"
  | "SLOT_FULL"
  | "CONCURRENT_MODIFICATION"
  | "SERVICE_UNAVAILABLE"
  | "PRICE_UNAVAILABLE"
  | "BOOKING_QUANTITY_OUT_OF_RANGE"
  | "PRICING_UNIT_NOT_BOOKABLE"
  | "SLOT_REQUIRED"
  | "SLOT_UNAVAILABLE"
  | "DUPLICATE_BOOKING"
  | "BOOKING_NOT_CANCELLABLE"
  // Gate PC (Provider Mutation API) — provider-side mutation rejection codes.
  // These carry the EXISTING provider domain error meanings (ServiceActionErrorCode,
  // AvailabilityActionErrorCode, provider-context BookingActionErrorCode) onto the
  // wire unchanged (mapped in src/lib/api/v1/provider-mutation-errors.ts). No new
  // domain behavior — only HTTP + wire shape for outcomes the domain already returns.
  | "BOOKING_NOT_ACTIONABLE"
  | "INVALID_STATUS_TRANSITION"
  | "SERVICE_NOT_PUBLISHABLE"
  | "INVALID_CATEGORY"
  // Gate B5 (Provider Service Category Authorization) — the category is valid but
  // the provider is not authorized for it. A distinct 403 so a native client can
  // tell "unauthorized activity" apart from "invalid category" (422).
  | "ACTIVITY_NOT_AUTHORIZED"
  // TOUR-1 — smart tour-guide template: content supplied for a non-eligible
  // service (422), or content that failed the strict guidingContent contract (422).
  | "TOUR_TEMPLATE_NOT_ELIGIBLE"
  | "TOUR_TEMPLATE_INVALID"
  // TOUR-VEHICLE-2 — vehicle-pool outcomes. The service is not a tour context that can
  // hold a vehicle pool (422), or the vehicle is not currently assignable to the package
  // — not ACTIVE/APPROVED, a required doc invalid, not trusted-4x4, or too small (422).
  | "TOUR_SERVICE_NOT_ELIGIBLE"
  | "TOUR_VEHICLE_NOT_ELIGIBLE"
  // BOOKING-VEHICLE-1 — provider acceptance vehicle-assignment outcomes carried onto the
  // wire (mapped in provider-mutation-errors.ts). A transport tour package needs a vehicle
  // (VEHICLE_REQUIRED, 422); the vehicle must be in the service pool (VEHICLE_NOT_IN_SERVICE_POOL,
  // 422 — also the uniform outcome for a foreign vehicle); it must carry the booking's party
  // (VEHICLE_CAPACITY_INSUFFICIENT, 422). "Not currently eligible" reuses TOUR_VEHICLE_NOT_ELIGIBLE;
  // a concurrent state change reuses CONCURRENT_MODIFICATION.
  | "VEHICLE_REQUIRED"
  | "VEHICLE_NOT_IN_SERVICE_POOL"
  | "VEHICLE_CAPACITY_INSUFFICIENT"
  // BOOKING-CONFLICT-1B — the selected vehicle is already committed to an overlapping active
  // reservation (409 Conflict; mapped in provider-mutation-errors.ts). The message is generic
  // and reveals nothing about the conflicting booking, customer, or time window.
  | "VEHICLE_BUSY"
  // BOOKING-INTERVAL-1 — provider acceptance operational-schedule outcomes (mapped in
  // provider-mutation-errors.ts). A slotless vehicle-required booking needs a provider-supplied
  // interval (SCHEDULE_REQUIRED, 422); a supplied interval that is malformed / start>=end is
  // INVALID_SCHEDULE (422). Distinct from SLOT_REQUIRED (the customer create-time slot rule).
  | "SCHEDULE_REQUIRED"
  | "INVALID_SCHEDULE"
  | "CAPACITY_BELOW_BOOKED"
  | "SLOT_HAS_BOOKINGS"
  // VEHICLE-1B (Provider Vehicle API) — a vehicle with this registration number
  // already exists (409). Deliberately generic: it never reveals which provider
  // owns the conflicting plate (the unique index is global).
  | "DUPLICATE_REGISTRATION"
  // VEHICLE-LC2B (Provider Vehicle Verification API) — vehicle-document + submission
  // outcomes carried onto the wire unchanged (mapped in vehicle-document-errors.ts).
  // A document of the required type already exists — replace it instead (409).
  | "DOCUMENT_ALREADY_EXISTS"
  // The document/verification can't be changed in its current state (verification
  // not editable, or the document is APPROVED) (409).
  | "DOCUMENT_LOCKED"
  // Submit blocked: required documents missing/rejected. blockers ride in details (422).
  | "VERIFICATION_NOT_READY"
  // REVIEW-API-1 — customer review creation outcomes, mirroring the domain's own
  // ReviewActionErrorCode. Rating outside the integer 1-5 range (422), content that
  // is blank after trimming or longer than 2000 characters (422), a booking that is
  // not COMPLETED (422), and a booking that already has a review (409 — the state
  // conflicts with the request, and a client retrying after an unknown outcome uses
  // exactly this code to learn its review did commit).
  | "INVALID_RATING"
  | "INVALID_CONTENT"
  | "BOOKING_NOT_REVIEWABLE"
  | "ALREADY_REVIEWED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NO_PROVIDER_PROFILE: 403,
  PROVIDER_NOT_APPROVED: 403,
  NO_CUSTOMER_PROFILE: 403,
  CUSTOMER_INCOMPLETE: 403,
  NOT_FOUND: 404,
  SLOT_FULL: 409,
  CONCURRENT_MODIFICATION: 409,
  SERVICE_UNAVAILABLE: 422,
  PRICE_UNAVAILABLE: 422,
  BOOKING_QUANTITY_OUT_OF_RANGE: 422,
  PRICING_UNIT_NOT_BOOKABLE: 422,
  SLOT_REQUIRED: 422,
  SLOT_UNAVAILABLE: 422,
  DUPLICATE_BOOKING: 422,
  BOOKING_NOT_CANCELLABLE: 422,
  // Gate PC — provider mutation conflicts (409) / unprocessable (422).
  BOOKING_NOT_ACTIONABLE: 409,
  INVALID_STATUS_TRANSITION: 409,
  SERVICE_NOT_PUBLISHABLE: 422,
  INVALID_CATEGORY: 422,
  ACTIVITY_NOT_AUTHORIZED: 403,
  TOUR_TEMPLATE_NOT_ELIGIBLE: 422,
  TOUR_TEMPLATE_INVALID: 422,
  TOUR_SERVICE_NOT_ELIGIBLE: 422,
  TOUR_VEHICLE_NOT_ELIGIBLE: 422,
  VEHICLE_REQUIRED: 422,
  VEHICLE_NOT_IN_SERVICE_POOL: 422,
  VEHICLE_CAPACITY_INSUFFICIENT: 422,
  // 409, not 422: the request is well-formed and the vehicle is eligible in principle — it is
  // the CURRENT STATE (an overlapping reservation) that conflicts. Same reasoning as SLOT_FULL.
  VEHICLE_BUSY: 409,
  SCHEDULE_REQUIRED: 422,
  INVALID_SCHEDULE: 422,
  CAPACITY_BELOW_BOOKED: 409,
  SLOT_HAS_BOOKINGS: 409,
  DUPLICATE_REGISTRATION: 409,
  DOCUMENT_ALREADY_EXISTS: 409,
  DOCUMENT_LOCKED: 409,
  VERIFICATION_NOT_READY: 422,
  INVALID_RATING: 422,
  INVALID_CONTENT: 422,
  BOOKING_NOT_REVIEWABLE: 422,
  // 409, not 422: the request is well-formed and the booking is eligible in
  // principle — it is the CURRENT STATE that conflicts, because a review already
  // exists. Same reasoning as DOCUMENT_ALREADY_EXISTS/SLOT_FULL above.
  ALREADY_REVIEWED: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

// Curated, human-safe messages. `en` is always present as the fallback; `ar` is
// provided for the platform's primary locale. Deliberately generic — never
// echoes back input, ids, or internal detail.
const MESSAGES: Record<ApiErrorCode, { en: string } & Partial<Record<Locale, string>>> = {
  INVALID_INPUT: { en: "Invalid request data.", ar: "بيانات الطلب غير صالحة." },
  UNAUTHORIZED: { en: "Authentication is required.", ar: "يلزم تسجيل الدخول." },
  FORBIDDEN: { en: "You do not have permission to perform this action.", ar: "ليست لديك صلاحية لتنفيذ هذا الإجراء." },
  NO_PROVIDER_PROFILE: {
    en: "This account does not have a provider profile.",
    ar: "لا يملك هذا الحساب ملف مزود خدمة.",
  },
  PROVIDER_NOT_APPROVED: {
    en: "Your provider account is not approved yet.",
    ar: "لم تتم الموافقة على حساب مزود الخدمة الخاص بك بعد.",
  },
  NO_CUSTOMER_PROFILE: {
    en: "You need to complete your customer profile before finishing this booking. Contact support if this message persists.",
    ar: "يلزم إكمال الملف الشخصي كعميل قبل إتمام الحجز. تواصل مع الدعم إذا استمرت هذه الرسالة.",
  },
  // PLATFORM-BOOKING-INCOMPLETE-ERROR-1 — actionable, unlike NO_CUSTOMER_PROFILE.
  CUSTOMER_INCOMPLETE: {
    en: "Please verify your email address before booking.",
    ar: "يرجى تأكيد بريدك الإلكتروني قبل الحجز.",
  },
  NOT_FOUND: { en: "The requested resource was not found.", ar: "المورد المطلوب غير موجود." },
  SLOT_FULL: { en: "Sorry, the remaining capacity for this slot was just taken.", ar: "للأسف، اكتملت السعة المتاحة لهذا الموعد للتو." },
  CONCURRENT_MODIFICATION: {
    en: "This booking was just modified. Please try again.",
    ar: "تم تعديل هذا الحجز للتو. الرجاء المحاولة مرة أخرى.",
  },
  SERVICE_UNAVAILABLE: { en: "This experience is not currently available for booking.", ar: "هذه التجربة غير متاحة للحجز حالياً." },
  PRICE_UNAVAILABLE: { en: "The selected price option is not available for this experience.", ar: "الخيار السعري المحدد غير متاح لهذه التجربة." },
  BOOKING_QUANTITY_OUT_OF_RANGE: { en: "The number of seats is outside the range this service allows.", ar: "عدد المقاعد خارج النطاق المسموح به لهذه الخدمة." },
  PRICING_UNIT_NOT_BOOKABLE: { en: "This pricing option is not available for booking yet.", ar: "خيار التسعير هذا غير متاح للحجز بعد." },
  // Distinct from SLOT_UNAVAILABLE on purpose: nothing was selected to become
  // unavailable. The service is slot-based and the request carried no slot at all.
  SLOT_REQUIRED: { en: "Please select a time slot for this experience.", ar: "الرجاء اختيار موعد لهذه التجربة." },
  SLOT_UNAVAILABLE: { en: "The selected time slot is no longer available.", ar: "الموعد المحدد لم يعد متاحاً." },
  DUPLICATE_BOOKING: { en: "You already have a booking for this time slot.", ar: "لديك بالفعل حجز لهذا الموعد." },
  BOOKING_NOT_CANCELLABLE: { en: "This booking cannot be cancelled in its current status.", ar: "لا يمكن إلغاء هذا الحجز في حالته الحالية." },
  BOOKING_NOT_ACTIONABLE: {
    en: "This booking can't take that action in its current status.",
    ar: "لا يمكن تنفيذ هذا الإجراء على الحجز في حالته الحالية.",
  },
  INVALID_STATUS_TRANSITION: {
    en: "This item can't change to that status from its current one.",
    ar: "لا يمكن تغيير الحالة إلى الحالة المطلوبة من الحالة الحالية.",
  },
  SERVICE_NOT_PUBLISHABLE: {
    en: "This experience can't be published yet. Resolve the listed requirements first.",
    ar: "لا يمكن نشر هذه التجربة بعد. الرجاء استيفاء المتطلبات المذكورة أولاً.",
  },
  INVALID_CATEGORY: {
    en: "The selected category can't be assigned to this experience.",
    ar: "لا يمكن تعيين الفئة المحددة لهذه التجربة.",
  },
  ACTIVITY_NOT_AUTHORIZED: {
    en: "This activity is not authorized for your provider account.",
    ar: "هذا النشاط غير مصرح به لحساب مزود الخدمة.",
  },
  TOUR_TEMPLATE_NOT_ELIGIBLE: {
    en: "Tour details can only be added to an individual tourist-guide service.",
    ar: "لا يمكن إضافة تفاصيل الجولة إلا لخدمة مرشد سياحي فردي.",
  },
  TOUR_TEMPLATE_INVALID: {
    en: "The tour details are incomplete or invalid.",
    ar: "تفاصيل الجولة غير مكتملة أو غير صالحة.",
  },
  TOUR_SERVICE_NOT_ELIGIBLE: {
    en: "This service can't have a vehicle pool.",
    ar: "لا يمكن لهذه الخدمة أن تملك مجموعة مركبات.",
  },
  TOUR_VEHICLE_NOT_ELIGIBLE: {
    en: "This vehicle isn't currently eligible for this tour.",
    ar: "هذه المركبة غير مؤهلة حالياً لهذه الجولة.",
  },
  VEHICLE_REQUIRED: {
    en: "Select a vehicle to accept this booking.",
    ar: "اختر مركبة لقبول هذا الحجز.",
  },
  VEHICLE_NOT_IN_SERVICE_POOL: {
    en: "This vehicle isn't part of this tour's vehicle pool.",
    ar: "هذه المركبة ليست ضمن مجموعة مركبات هذه الجولة.",
  },
  VEHICLE_CAPACITY_INSUFFICIENT: {
    en: "This vehicle can't carry the number of guests on this booking.",
    ar: "لا تتسع هذه المركبة لعدد ضيوف هذا الحجز.",
  },
  VEHICLE_BUSY: {
    en: "The selected vehicle is already assigned to another booking during this time.",
    ar: "المركبة المحددة مرتبطة بحجز آخر خلال هذه الفترة.",
  },
  SCHEDULE_REQUIRED: {
    en: "Set a start and end time before accepting this booking.",
    ar: "حدد وقت البداية والنهاية قبل قبول هذا الحجز.",
  },
  INVALID_SCHEDULE: {
    en: "The start and end time are invalid.",
    ar: "وقت البداية والنهاية غير صالح.",
  },
  CAPACITY_BELOW_BOOKED: {
    en: "Capacity can't be set below the number of seats already booked.",
    ar: "لا يمكن تعيين السعة أقل من عدد المقاعد المحجوزة بالفعل.",
  },
  SLOT_HAS_BOOKINGS: {
    en: "This time slot has active bookings and can't be modified or removed.",
    ar: "يحتوي هذا الموعد على حجوزات نشطة ولا يمكن تعديله أو حذفه.",
  },
  DUPLICATE_REGISTRATION: {
    en: "A vehicle with this registration number already exists.",
    ar: "توجد بالفعل مركبة بهذا رقم التسجيل.",
  },
  DOCUMENT_ALREADY_EXISTS: {
    en: "A document of this type already exists. Replace it instead.",
    ar: "يوجد مستند من هذا النوع بالفعل. استبدله بدلاً من ذلك.",
  },
  DOCUMENT_LOCKED: {
    en: "This document can't be changed in its current state.",
    ar: "لا يمكن تغيير هذا المستند في حالته الحالية.",
  },
  VERIFICATION_NOT_READY: {
    en: "Complete the required documents before submitting for verification.",
    ar: "أكمل المستندات المطلوبة قبل الإرسال للتحقق.",
  },
  // Mirrors the committed web copy in messages/{en,ar}/errors.json — invalidRating,
  // invalidContent, bookingNotReviewable and alreadyReviewed — so the same failure
  // reads the same way whichever client a customer is using.
  INVALID_RATING: {
    en: "Please select a rating between 1 and 5.",
    ar: "الرجاء اختيار تقييم بين 1 و5.",
  },
  INVALID_CONTENT: {
    en: "Please write a short review before submitting.",
    ar: "الرجاء كتابة تعليق قصير قبل الإرسال.",
  },
  BOOKING_NOT_REVIEWABLE: {
    en: "This booking cannot be reviewed — only completed bookings are eligible.",
    ar: "لا يمكن تقييم هذا الحجز — التقييم متاح فقط للحجوزات المكتملة.",
  },
  ALREADY_REVIEWED: {
    en: "You've already submitted a review for this booking.",
    ar: "لقد أرسلت بالفعل تقييمًا لهذا الحجز.",
  },
  RATE_LIMITED: {
    en: "You're making requests too quickly. Please wait a moment and try again.",
    ar: "أنت ترسل الطلبات بسرعة كبيرة. الرجاء الانتظار قليلاً ثم المحاولة مرة أخرى.",
  },
  INTERNAL_ERROR: { en: "Something went wrong, please try again.", ar: "حدث خطأ ما، الرجاء المحاولة مرة أخرى." },
};

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
    retryAfterSeconds?: number;
  };
}

export interface ApiErrorOptions {
  locale?: Locale;
  /** Override the curated message (still must be human-safe — never raw exceptions). */
  message?: string;
  details?: Record<string, unknown>;
  retryAfterSeconds?: number;
  /** Override the default HTTP status for this code (rarely needed). */
  status?: number;
}

/** Resolve the safe, localized message for a code, honoring the requested locale. */
export function apiErrorMessage(code: ApiErrorCode, locale: Locale = defaultLocale): string {
  const catalog = MESSAGES[code];
  return catalog[locale] ?? catalog.en;
}

/** Build the JSON body for an API error (no HTTP wrapper) — useful for tests. */
export function buildApiErrorBody(code: ApiErrorCode, options: ApiErrorOptions = {}): ApiErrorBody {
  const message = options.message ?? apiErrorMessage(code, options.locale ?? defaultLocale);
  const body: ApiErrorBody = { error: { code, message } };
  if (options.details) body.error.details = options.details;
  if (options.retryAfterSeconds !== undefined) body.error.retryAfterSeconds = options.retryAfterSeconds;
  return body;
}

/** Build a NextResponse carrying the standard API error envelope + no-store. */
export function apiError(code: ApiErrorCode, options: ApiErrorOptions = {}): NextResponse {
  const response = NextResponse.json(buildApiErrorBody(code, options), {
    status: options.status ?? STATUS_BY_CODE[code],
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
