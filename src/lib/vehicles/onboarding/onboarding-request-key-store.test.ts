import { describe, it, expect } from "vitest";
import {
  ONBOARDING_KEY_STORAGE_NAME,
  resolveOnboardingRequestKey,
  rotateOnboardingRequestKey,
  markOnboardingKeyAttempted,
  clearOnboardingRequestKey,
  generateOnboardingRequestKey,
  type KeyStorage,
} from "./onboarding-request-key-store";
import { ONBOARDING_KEY_CLIENT_MAX_AGE_MS, ONBOARDING_REQUEST_RETENTION_MS, ONBOARDING_LEASE_MS, ONBOARDING_IN_PROGRESS_WAIT_MS } from "./onboarding-request-policy";

// BROWSER IDEMPOTENCY-STATE tests. The key lifecycle is pure logic over an injected Storage, so the
// ten required behaviours are exercised here exactly as the upload form drives them — with an
// in-memory stand-in for one tab's sessionStorage. (Real-device behaviour is checked by hand.)

class TabStorage implements KeyStorage {
  private data = new Map<string, string>();
  getItem(k: string) { return this.data.has(k) ? this.data.get(k)! : null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  raw() { return this.data.get(ONBOARDING_KEY_STORAGE_NAME) ?? null; }
}
const PROVIDER_A = "scope-a-0000000000000000";
const PROVIDER_B = "scope-b-0000000000000000";
let counter = 0;
const generate = () => `generated-key-${++counter}`;
const visit = (tab: KeyStorage | null, scope = PROVIDER_A, now?: number) => resolveOnboardingRequestKey(tab, { scope, generate, now });

describe("browser request key — the ten required behaviours", () => {
  it("1. first opening the upload step creates ONE key and stores it", () => {
    const tab = new TabStorage();
    const first = visit(tab);
    expect(first).toMatchObject({ attempted: false, reused: false });
    expect(JSON.parse(tab.raw()!)).toMatchObject({ key: first.key, scope: PROVIDER_A, attempted: false });
  });

  it("2. re-render and hydration do not replace it (resolving again returns the same key)", () => {
    const tab = new TabStorage();
    const first = visit(tab);
    for (let i = 0; i < 5; i++) expect(visit(tab)).toEqual({ key: first.key, attempted: false, reused: true });
  });

  it("3. a reload reuses it (a new page instance over the same tab storage)", () => {
    const tab = new TabStorage();
    const before = visit(tab);
    markOnboardingKeyAttempted(tab, PROVIDER_A); // request sent, response lost
    const afterReload = visit(tab);
    expect(afterReload).toEqual({ key: before.key, attempted: true, reused: true });
  });

  it("4. a network retry reuses it", () => {
    const tab = new TabStorage();
    const key = visit(tab).key;
    markOnboardingKeyAttempted(tab, PROVIDER_A);
    markOnboardingKeyAttempted(tab, PROVIDER_A); // retry
    expect(visit(tab).key).toBe(key);
  });

  it("5. back/forward navigation during the same attempt reuses it", () => {
    const tab = new TabStorage();
    const key = visit(tab).key;
    markOnboardingKeyAttempted(tab, PROVIDER_A);
    expect(visit(tab).key).toBe(key); // page restored
    expect(visit(tab).attempted).toBe(true);
  });

  it("6. a successful upload or resume clears it — the next visit is a NEW request", () => {
    const tab = new TabStorage();
    const key = visit(tab).key;
    clearOnboardingRequestKey(tab);
    expect(tab.raw()).toBeNull();
    const next = visit(tab);
    expect(next.key).not.toBe(key);
    expect(next).toMatchObject({ attempted: false, reused: false });
  });

  it("7. a confirmed cancellation clears the browser copy (the server tombstone is not the browser's to remove)", () => {
    const tab = new TabStorage();
    const key = visit(tab).key;
    markOnboardingKeyAttempted(tab, PROVIDER_A);
    clearOnboardingRequestKey(tab);
    expect(visit(tab).key).not.toBe(key);
  });

  it("8. explicitly starting another vehicle creates a new key, even mid-attempt", () => {
    const tab = new TabStorage();
    const key = visit(tab).key;
    markOnboardingKeyAttempted(tab, PROVIDER_A);
    const rotated = rotateOnboardingRequestKey(tab, { scope: PROVIDER_A, generate });
    expect(rotated.key).not.toBe(key);
    expect(rotated).toMatchObject({ attempted: false, reused: false });
    expect(visit(tab).key).toBe(rotated.key); // and it is now the stable key
  });

  it("9. signing out clears it", () => {
    const tab = new TabStorage();
    const key = visit(tab).key;
    clearOnboardingRequestKey(tab); // LogoutButton
    expect(tab.raw()).toBeNull();
    expect(visit(tab).key).not.toBe(key); // the same provider signing back in starts fresh
  });

  it("10. another provider in the same browser never inherits the key", () => {
    const tab = new TabStorage();
    const keyA = visit(tab, PROVIDER_A).key;
    markOnboardingKeyAttempted(tab, PROVIDER_A);
    const b = visit(tab, PROVIDER_B); // sign-out did not run (e.g. session expired), B signs in
    expect(b.key).not.toBe(keyA);
    expect(b).toMatchObject({ attempted: false, reused: false });
    expect(JSON.parse(tab.raw()!).scope).toBe(PROVIDER_B); // A's record is gone, not kept alongside
    markOnboardingKeyAttempted(tab, PROVIDER_A); // a stale write for A cannot touch B's record
    expect(visit(tab, PROVIDER_B)).toMatchObject({ key: b.key, attempted: false });
  });
});

describe("browser request key — bounds and robustness", () => {
  it("a key older than the client limit is discarded (this is what lets the server purge old rows safely)", () => {
    const tab = new TabStorage();
    const t0 = 1_800_000_000_000;
    const key = visit(tab, PROVIDER_A, t0).key;
    expect(visit(tab, PROVIDER_A, t0 + ONBOARDING_KEY_CLIENT_MAX_AGE_MS - 1).key).toBe(key);
    expect(visit(tab, PROVIDER_A, t0 + ONBOARDING_KEY_CLIENT_MAX_AGE_MS).key).not.toBe(key);
  });

  it("a record from the future (clock change) is not trusted", () => {
    const tab = new TabStorage();
    const key = visit(tab, PROVIDER_A, 2_000_000_000_000).key;
    expect(visit(tab, PROVIDER_A, 1_000_000_000_000).key).not.toBe(key);
  });

  it.each([
    ["not JSON", "{{{"],
    ["wrong shape", JSON.stringify(["x"])],
    ["malformed key", JSON.stringify({ key: "bad key!", scope: PROVIDER_A, createdAt: Date.now(), attempted: false })],
    ["too-short key", JSON.stringify({ key: "abc", scope: PROVIDER_A, createdAt: Date.now(), attempted: false })],
    ["missing scope", JSON.stringify({ key: "valid-key-123", createdAt: Date.now() })],
    ["non-numeric time", JSON.stringify({ key: "valid-key-123", scope: PROVIDER_A, createdAt: "now" })],
  ])("a tampered or corrupt record (%s) is replaced by a fresh key", (_label, raw) => {
    const tab = new TabStorage();
    tab.setItem(ONBOARDING_KEY_STORAGE_NAME, raw);
    const resolved = visit(tab);
    expect(resolved.reused).toBe(false);
    expect(JSON.parse(tab.raw()!).key).toBe(resolved.key);
  });

  it("storage that throws (private mode / blocked site data) never breaks the form — an in-memory key is used", () => {
    const broken: KeyStorage = {
      getItem() { throw new Error("SecurityError"); },
      setItem() { throw new Error("QuotaExceededError"); },
      removeItem() { throw new Error("SecurityError"); },
    };
    expect(visit(broken)).toMatchObject({ attempted: false, reused: false });
    expect(() => markOnboardingKeyAttempted(broken, PROVIDER_A)).not.toThrow();
    expect(() => clearOnboardingRequestKey(broken)).not.toThrow();
    expect(visit(null)).toMatchObject({ reused: false }); // no storage at all
    expect(() => clearOnboardingRequestKey(null)).not.toThrow();
  });

  it("the stored record holds only the key, the opaque scope, a time and a flag — nothing else", () => {
    const tab = new TabStorage();
    visit(tab);
    expect(Object.keys(JSON.parse(tab.raw()!)).sort()).toEqual(["attempted", "createdAt", "key", "scope"]);
  });

  it("generated keys are unique and pass the server's key format", () => {
    const keys = new Set(Array.from({ length: 500 }, () => generateOnboardingRequestKey()));
    expect(keys.size).toBe(500);
    for (const k of keys) expect(k).toMatch(/^[A-Za-z0-9._-]{8,200}$/);
  });
});

describe("timing policy — the numbers are consistent with each other", () => {
  it("server retention far exceeds the browser key lifetime (a row is never purged while a replay can still arrive)", () => {
    expect(ONBOARDING_REQUEST_RETENTION_MS).toBeGreaterThanOrEqual(ONBOARDING_KEY_CLIENT_MAX_AGE_MS * 7);
    expect(ONBOARDING_KEY_CLIENT_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
    expect(ONBOARDING_REQUEST_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("a lease outlasts the longest the upload route can run, and a duplicate waits less than that route may run", () => {
    const ROUTE_MAX_DURATION_MS = 30_000;
    expect(ONBOARDING_LEASE_MS).toBeGreaterThan(ROUTE_MAX_DURATION_MS * 2);
    expect(ONBOARDING_IN_PROGRESS_WAIT_MS).toBeLessThan(ROUTE_MAX_DURATION_MS);
  });
});
