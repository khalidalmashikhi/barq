import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Media Foundation (Gap C) — the ONLY place the Supabase Storage SDK is
// touched. Everything above this file (validation, key layout, the
// provider-logo orchestration) is Supabase-agnostic and unit-testable;
// this thin adapter is the network boundary.
//
// GRACEFUL DEGRADATION: the three SUPABASE_* env vars are OPTIONAL (see
// scripts/env-schema.ts). If they are unset, `isStorageConfigured()`
// returns false and callers surface a clean "storage not configured"
// error instead of the app crashing or the build failing. This is what
// lets the whole foundation ship non-breakingly BEFORE the Supabase
// bucket + service-role key are provisioned on the deployment — the media
// UI/actions exist but decline politely until the infra is in place.
//
// SERVICE-ROLE KEY: used server-side only (this file is `server-only`),
// never shipped to the browser. Uploads flow browser → our route handler
// (authenticated) → here, so the key and the bucket write path never
// leave the server; the browser never talks to Supabase directly.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Public-read bucket holding marketplace media (provider logos, service
// photos) — this content is inherently public (shown to every tourist),
// so a public bucket is correct; WRITE authority stays server-side via the
// service-role key + our own ownership checks.
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "media";
// Provider Verification & Documents (Gate 2) — a SEPARATE, PRIVATE bucket for
// provider verification documents. Deliberately has NO default: unlike the
// public media bucket, documents must NEVER silently fall back to the public
// bucket, so if this is unset the document storage is simply "not configured"
// (isDocumentStorageConfigured() → false) and every document op declines
// politely. Verification documents are private artifacts: they are read only
// via short-lived signed URLs minted server-side after authorization, never a
// public URL.
const DOCS_BUCKET = process.env.SUPABASE_DOCS_BUCKET;

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("Object storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY unset).");
    this.name = "StorageNotConfiguredError";
  }
}

export class StorageOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageOperationError";
  }
}

export function isStorageConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

let cachedClient: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new StorageNotConfiguredError();
  }
  if (!cachedClient) {
    cachedClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cachedClient;
}

export function getPublicObjectUrl(objectKey: string): string {
  return getClient().storage.from(BUCKET).getPublicUrl(objectKey).data.publicUrl;
}

export async function uploadObject(params: {
  objectKey: string;
  body: ArrayBuffer | Uint8Array;
  contentType: string;
}): Promise<void> {
  const { error } = await getClient()
    .storage.from(BUCKET)
    .upload(params.objectKey, params.body, { contentType: params.contentType, upsert: true });
  if (error) {
    throw new StorageOperationError(error.message);
  }
}

// Best-effort object removal. Never throws for a missing object — used for
// cleanup of a replaced/deleted media object where the DB row is already
// the source of truth.
export async function removeObject(objectKey: string): Promise<void> {
  const { error } = await getClient().storage.from(BUCKET).remove([objectKey]);
  if (error) {
    throw new StorageOperationError(error.message);
  }
}

// ============================================================================
// Private document storage (Provider Verification & Documents, Gate 2)
// ============================================================================
// A distinct set of primitives for the PRIVATE documents bucket. They reuse the
// same service-role client (which can access any bucket) but NEVER the public
// `BUCKET`, and they never produce a public URL — reads go through
// createSignedObjectUrl() only. The public-media functions above are untouched.

// Fail-closed: document storage is configured only when the URL, the
// service-role key, AND a dedicated private docs bucket are all set. There is
// no default bucket — an unset SUPABASE_DOCS_BUCKET means "not configured",
// never a fall back to the public media bucket.
export function isDocumentStorageConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && DOCS_BUCKET);
}

function getDocsBucket(): string {
  if (!DOCS_BUCKET) {
    throw new StorageNotConfiguredError();
  }
  return DOCS_BUCKET;
}

// Upload to the private docs bucket. upsert:false — document object keys are
// immutable (a fresh uuid per upload/replace), so an existing key must never be
// silently overwritten.
export async function uploadPrivateObject(params: {
  objectKey: string;
  body: ArrayBuffer | Uint8Array;
  contentType: string;
}): Promise<void> {
  const { error } = await getClient()
    .storage.from(getDocsBucket())
    .upload(params.objectKey, params.body, { contentType: params.contentType, upsert: false });
  if (error) {
    throw new StorageOperationError(error.message);
  }
}

// Best-effort private-object removal (replaced/deleted document cleanup, where
// the DB row is already the source of truth).
export async function removePrivateObject(objectKey: string): Promise<void> {
  const { error } = await getClient().storage.from(getDocsBucket()).remove([objectKey]);
  if (error) {
    throw new StorageOperationError(error.message);
  }
}

// Mint a short-lived signed URL for a private document object. The URL is
// returned to the caller (a server route) which redirects to it; it is never
// persisted and the raw objectKey is never exposed to any client. When
// `downloadFilename` is given, the signed URL forces a Content-Disposition
// attachment with that (already-sanitized) filename — documents are downloaded,
// never rendered inline (defense against any HTML/script-ish payload).
export async function createSignedObjectUrl(
  objectKey: string,
  expiresInSeconds: number,
  options?: { downloadFilename?: string }
): Promise<string> {
  const { data, error } = await getClient()
    .storage.from(getDocsBucket())
    .createSignedUrl(objectKey, expiresInSeconds, { download: options?.downloadFilename ?? true });
  if (error || !data?.signedUrl) {
    throw new StorageOperationError(error?.message ?? "Failed to create signed URL");
  }
  return data.signedUrl;
}
