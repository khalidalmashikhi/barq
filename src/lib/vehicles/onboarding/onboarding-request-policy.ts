// Phase 3C Slice 3B — the timing policy of the durable onboarding request (idempotency authority).
// Pure and isomorphic: shared by the server (which enforces it) and the upload form (which keeps the
// browser's copy of the request key). No server-only, no DOM.

const SECOND = 1000;
const HOUR = 60 * 60 * SECOND;
const DAY = 24 * HOUR;

/**
 * How long ONE attempt may hold a PENDING request. Far longer than the upload route can run
 * (maxDuration 30 s), so a live attempt never loses its lease; an attempt that crashed or timed out
 * stops blocking retries after this long. A handled failure releases the lease immediately.
 */
export const ONBOARDING_LEASE_MS = 120 * SECOND;

/** How long a duplicate request waits for the in-flight attempt to finish before answering "in progress". */
export const ONBOARDING_IN_PROGRESS_WAIT_MS = 15 * SECOND;
export const ONBOARDING_IN_PROGRESS_POLL_MS = 300;

/**
 * How long the BROWSER may keep reusing a request key. After this the form discards its copy and
 * starts a new request, so no replay can arrive later than this after the key was first issued.
 */
export const ONBOARDING_KEY_CLIENT_MAX_AGE_MS = 24 * HOUR;

/**
 * RETENTION of a request row (success result or cancelled tombstone), counted from its last state
 * change. It is 30× the lifetime of the browser's copy of the key, so a row is never purged while a
 * replay can still arrive. A purge after this point only forgets requests nobody can repeat.
 */
export const ONBOARDING_REQUEST_RETENTION_MS = 30 * DAY;

/** Upper bound on rows removed by one purge run. */
export const ONBOARDING_PURGE_BATCH = 200;
