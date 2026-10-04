// A LOG-SAFE description of a thrown error for the vehicle-document upload paths.
//
// A raw `error.message` must never be logged here: a storage error can echo the private object key
// or a signed URL, and a database-client error can echo the query arguments (the onboarding request
// key, the original filename). This reduces any error to a fixed category — the error's class name
// plus, when present, a short machine code (e.g. a Prisma `P2002`) — and nothing else.
//
// Same intent as classifyStorageError in the cleanup outbox; isomorphic and dependency-free.

const SAFE_TOKEN = /^[A-Za-z0-9_.-]{1,40}$/;

export function safeErrorCategory(error: unknown): string {
  if (!(error instanceof Error)) return "NonError";
  const name = SAFE_TOKEN.test(error.name) ? error.name : "Error";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && SAFE_TOKEN.test(code) ? `${name}:${code}` : name;
}
