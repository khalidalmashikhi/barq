import "server-only";
import type { RateLimitConfig } from "./rate-limiter";

// Rate-limit tuning configuration — Production Hardening. Mirrors
// src/lib/otp/otp-config.ts's exact shape (readPositiveInt, throw on a
// malformed-but-set value rather than silently falling back) — the same
// fail-fast convention already established for tunable production
// knobs in this codebase.
//
// Defaults are deliberately generous (not a tight throttle): this is an
// abuse guard, not a UX-facing quota — a legitimate customer creating a
// handful of bookings or leaving a few reviews in an hour must never be
// blocked. Env vars let an operator tighten (or loosen) these without a
// code change if real traffic patterns call for it.

function readPositiveInt(envVar: string, fallback: number): number {
  const raw = process.env[envVar];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${envVar} must be a positive integer if set (got: "${raw}")`);
  }
  return parsed;
}

export function getBookingCreateRateLimit(): RateLimitConfig {
  return {
    limit: readPositiveInt("RATE_LIMIT_BOOKING_CREATE_MAX", 20),
    windowMs: readPositiveInt("RATE_LIMIT_BOOKING_CREATE_WINDOW_SECONDS", 3600) * 1000,
  };
}

export function getReviewCreateRateLimit(): RateLimitConfig {
  return {
    limit: readPositiveInt("RATE_LIMIT_REVIEW_CREATE_MAX", 20),
    windowMs: readPositiveInt("RATE_LIMIT_REVIEW_CREATE_WINDOW_SECONDS", 3600) * 1000,
  };
}
