import { ONBOARDING_KEY_CLIENT_MAX_AGE_MS } from "./onboarding-request-policy";

// Phase 3C Slice 3B — the BROWSER's copy of the onboarding request key.
//
// The server makes a request key idempotent; this module makes the browser keep SENDING THE SAME KEY
// for one attempt, so a lost response followed by a reload, a retry or a back/forward navigation is
// answered with the setup that already exists instead of creating another one.
//
// Kept in sessionStorage — per tab, gone when the tab closes — under one fixed name, as a small
// record scoped to:
//   • the authenticated provider (an opaque scope tag from the server; a different provider in the
//     same browser never inherits the key — the record is discarded on a scope mismatch);
//   • the new-vehicle onboarding flow (this storage name is used by nothing else);
//   • a bounded age (a key older than the client limit is discarded, which is what lets the server
//     purge old request rows safely).
//
// LIFECYCLE
//   resolve  — first visit creates the key; hydration, re-render, reload, retry and back/forward
//              navigation all return the SAME key while the attempt is unresolved;
//   clear    — the upload succeeded or was resumed, a setup was cancelled (the SERVER keeps its
//              tombstone), or the provider signed out;
//   rotate   — the provider explicitly asked to start another vehicle.
//
// The key is never written to a URL, a log or analytics by this module. Pure logic over an
// injected Storage, so it is unit-tested without a DOM; every storage call is guarded (private
// mode / blocked site data) and the form still works with an in-memory key when storage is absent.

export const ONBOARDING_KEY_STORAGE_NAME = "barq.vehicleOnboarding.request.v1";

export type KeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StoredRequestKey = { key: string; scope: string; createdAt: number; attempted: boolean };

export type ResolvedRequestKey = {
  key: string;
  /** A submission with this key has been started; its outcome may be unknown to the browser. */
  attempted: boolean;
  /** True when an existing unresolved key was reused rather than a new one created. */
  reused: boolean;
};

// Same format rule the server applies (isValidIdempotencyKey) — duplicated here because that module
// is server-side; a key failing it would be refused by the server anyway.
const KEY_FORMAT = /^[A-Za-z0-9._-]{8,200}$/;

function read(storage: KeyStorage): StoredRequestKey | null {
  try {
    const raw = storage.getItem(ONBOARDING_KEY_STORAGE_NAME);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { key, scope, createdAt, attempted } = parsed as Record<string, unknown>;
    if (typeof key !== "string" || !KEY_FORMAT.test(key)) return null;
    if (typeof scope !== "string" || typeof createdAt !== "number" || !Number.isFinite(createdAt)) return null;
    return { key, scope, createdAt, attempted: attempted === true };
  } catch {
    return null;
  }
}

function write(storage: KeyStorage, entry: StoredRequestKey): void {
  try {
    storage.setItem(ONBOARDING_KEY_STORAGE_NAME, JSON.stringify(entry));
  } catch {
    /* storage unavailable — the caller keeps the key in memory for this page */
  }
}

function usable(entry: StoredRequestKey | null, scope: string, now: number): entry is StoredRequestKey {
  if (!entry || entry.scope !== scope) return false;
  const age = now - entry.createdAt;
  return age >= 0 && age < ONBOARDING_KEY_CLIENT_MAX_AGE_MS;
}

/**
 * The key this tab must use for the provider's current onboarding attempt: the stored one while it
 * is still usable, otherwise a newly generated one (which is stored). Never replaces a usable key.
 */
export function resolveOnboardingRequestKey(storage: KeyStorage | null, params: { scope: string; generate: () => string; now?: number }): ResolvedRequestKey {
  const now = params.now ?? Date.now();
  if (storage) {
    const existing = read(storage);
    if (usable(existing, params.scope, now)) return { key: existing.key, attempted: existing.attempted, reused: true };
  }
  const key = params.generate();
  if (storage) write(storage, { key, scope: params.scope, createdAt: now, attempted: false });
  return { key, attempted: false, reused: false };
}

/** Record that a submission with the current key has started (its outcome may never be seen). */
export function markOnboardingKeyAttempted(storage: KeyStorage | null, scope: string, now: number = Date.now()): void {
  if (!storage) return;
  const existing = read(storage);
  if (usable(existing, scope, now) && !existing.attempted) write(storage, { ...existing, attempted: true });
}

/** Forget the browser's copy (success/resume, cancellation, sign-out). The server record stays. */
export function clearOnboardingRequestKey(storage: KeyStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(ONBOARDING_KEY_STORAGE_NAME);
  } catch {
    /* nothing to clear */
  }
}

/** EXPLICIT new attempt ("add another vehicle" / "start a new setup"): always a different key. */
export function rotateOnboardingRequestKey(storage: KeyStorage | null, params: { scope: string; generate: () => string; now?: number }): ResolvedRequestKey {
  clearOnboardingRequestKey(storage);
  return resolveOnboardingRequestKey(storage, params);
}

/** A new opaque request key (random; passes the server's key format). */
export function generateOnboardingRequestKey(): string {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256); // no Web Crypto at all — uniqueness only
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The tab's sessionStorage, or null when it is unavailable (SSR, private mode, blocked data). */
export function safeSessionStorage(): KeyStorage | null {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}
