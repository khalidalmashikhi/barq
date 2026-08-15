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
  | "NOT_FOUND"
  | "SLOT_FULL"
  | "CONCURRENT_MODIFICATION"
  | "SERVICE_UNAVAILABLE"
  | "PRICE_UNAVAILABLE"
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
  | "CAPACITY_BELOW_BOOKED"
  | "SLOT_HAS_BOOKINGS"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NO_PROVIDER_PROFILE: 403,
  PROVIDER_NOT_APPROVED: 403,
  NO_CUSTOMER_PROFILE: 403,
  NOT_FOUND: 404,
  SLOT_FULL: 409,
  CONCURRENT_MODIFICATION: 409,
  SERVICE_UNAVAILABLE: 422,
  PRICE_UNAVAILABLE: 422,
  SLOT_UNAVAILABLE: 422,
  DUPLICATE_BOOKING: 422,
  BOOKING_NOT_CANCELLABLE: 422,
  // Gate PC — provider mutation conflicts (409) / unprocessable (422).
  BOOKING_NOT_ACTIONABLE: 409,
  INVALID_STATUS_TRANSITION: 409,
  SERVICE_NOT_PUBLISHABLE: 422,
  INVALID_CATEGORY: 422,
  CAPACITY_BELOW_BOOKED: 409,
  SLOT_HAS_BOOKINGS: 409,
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
  NOT_FOUND: { en: "The requested resource was not found.", ar: "المورد المطلوب غير موجود." },
  SLOT_FULL: { en: "Sorry, the remaining capacity for this slot was just taken.", ar: "للأسف، اكتملت السعة المتاحة لهذا الموعد للتو." },
  CONCURRENT_MODIFICATION: {
    en: "This booking was just modified. Please try again.",
    ar: "تم تعديل هذا الحجز للتو. الرجاء المحاولة مرة أخرى.",
  },
  SERVICE_UNAVAILABLE: { en: "This experience is not currently available for booking.", ar: "هذه التجربة غير متاحة للحجز حالياً." },
  PRICE_UNAVAILABLE: { en: "The selected price option is not available for this experience.", ar: "الخيار السعري المحدد غير متاح لهذه التجربة." },
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
  CAPACITY_BELOW_BOOKED: {
    en: "Capacity can't be set below the number of seats already booked.",
    ar: "لا يمكن تعيين السعة أقل من عدد المقاعد المحجوزة بالفعل.",
  },
  SLOT_HAS_BOOKINGS: {
    en: "This time slot has active bookings and can't be modified or removed.",
    ar: "يحتوي هذا الموعد على حجوزات نشطة ولا يمكن تعديله أو حذفه.",
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
