import "server-only";

// In-memory rate limiter — Production Hardening.
//
// WHY IN-MEMORY, NOT DATABASE-BACKED: this phase's own constraints rule
// out both a Prisma schema change (no new table) and a third-party
// dependency (no Redis/Upstash) — an in-process fixed-window counter is
// the only option left that satisfies both. This is a REAL, INTENTIONAL
// LIMITATION, not an oversight: state lives in this one Node.js process
// only. On a platform that runs multiple concurrent instances (Vercel's
// serverless functions, a multi-replica deployment), each instance
// enforces its own independent limit — the effective ceiling for a
// single identity is `limit * (number of warm instances currently
// serving requests)`, not a strict global cap. State also resets
// whenever an instance cold-starts. For a low-stakes abuse guard on
// booking/review creation (not a security-critical control like OTP
// verification, which already has its own database-backed cooldown —
// see src/lib/otp/check-resend-cooldown.ts), this trade-off is
// acceptable: it still meaningfully raises the cost of casual scripted
// abuse without requiring new infrastructure. A future phase with a
// real durable store (Redis, or a dedicated table) could tighten this
// to a true global limit without changing any call site's own
// interface — only this file's internals.
//
// FIXED WINDOW, NOT SLIDING: a caller can in principle send `limit`
// requests right at the end of one window and another `limit` right at
// the start of the next, doubling the effective rate for a brief burst
// at the boundary. Documented, accepted trade-off for the same reason
// as above — this is an abuse deterrent, not a precise throttle.

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, RateLimitEntry>();

// `now` is injectable (defaults to Date.now()) specifically so tests can
// assert window-boundary behavior deterministically, without depending
// on real wall-clock time or fake timers — mirrors this codebase's
// existing "pure logic, injected dependencies" testability convention
// (see src/lib/booking/booking-status.ts and this phase's
// share-or-copy.ts).
export function checkRateLimit(key: string, config: RateLimitConfig, now: number = Date.now()): RateLimitResult {
  const entry = store.get(key);

  if (!entry || now - entry.windowStart >= config.windowMs) {
    store.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (entry.count < config.limit) {
    entry.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((config.windowMs - (now - entry.windowStart)) / 1000));
  return { allowed: false, retryAfterSeconds };
}

// Test-only reset — the module-scope Map would otherwise leak state
// between test files/cases that happen to reuse the same key.
export function _resetRateLimitStoreForTests(): void {
  store.clear();
}
