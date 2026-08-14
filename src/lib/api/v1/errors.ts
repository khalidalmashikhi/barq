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
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
};

// Curated, human-safe messages. `en` is always present as the fallback; `ar` is
// provided for the platform's primary locale. Deliberately generic — never
// echoes back input, ids, or internal detail.
const MESSAGES: Record<ApiErrorCode, { en: string } & Partial<Record<Locale, string>>> = {
  INVALID_INPUT: { en: "Invalid request data.", ar: "بيانات الطلب غير صالحة." },
  UNAUTHENTICATED: { en: "Authentication is required.", ar: "يلزم تسجيل الدخول." },
  FORBIDDEN: { en: "You do not have permission to perform this action.", ar: "ليست لديك صلاحية لتنفيذ هذا الإجراء." },
  NOT_FOUND: { en: "The requested resource was not found.", ar: "المورد المطلوب غير موجود." },
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
