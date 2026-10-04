import "server-only";
import { createClaudeVisionRegistrationReader, DEFAULT_CLAUDE_REGISTRATION_MODEL } from "./claude-vision-reader";
import type { RegistrationDocumentReader } from "./registration-document-reader";

// Phase 3C (registration OCR) — resolves the OCR engine for THIS environment, FAIL CLOSED.
//
//   REGISTRATION_OCR_PROVIDER   "disabled" (default) | "claude"
//   ANTHROPIC_API_KEY           required when the provider is "claude" (server-only secret)
//   REGISTRATION_OCR_MODEL      optional model override for the Claude reader
//
// Anything that is not a complete, valid configuration yields `null`: no document is sent anywhere,
// photos and scans stay on the manual path, and the UI says automatic reading is unavailable. An
// unknown provider name, a missing key or a malformed model name never falls back to "some" engine.
// The configuration is read on every call (cheap) so a deployment's env change needs no code path.

const MODEL_NAME = /^claude-[a-z0-9][a-z0-9.-]{2,60}$/;

export type RegistrationOcrProvider = "disabled" | "claude";

export function resolveRegistrationOcrProvider(env: Record<string, string | undefined> = process.env): RegistrationOcrProvider {
  return env.REGISTRATION_OCR_PROVIDER === "claude" ? "claude" : "disabled";
}

export function getRegistrationDocumentReader(env: Record<string, string | undefined> = process.env): RegistrationDocumentReader | null {
  if (resolveRegistrationOcrProvider(env) !== "claude") return null;
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null; // selected but not credentialed → not operational
  const requestedModel = env.REGISTRATION_OCR_MODEL?.trim();
  if (requestedModel && !MODEL_NAME.test(requestedModel)) return null; // a malformed override is a misconfiguration, not a hint
  return createClaudeVisionRegistrationReader({ apiKey, model: requestedModel || DEFAULT_CLAUDE_REGISTRATION_MODEL });
}

/** Whether photos and scans can be read automatically here. For honest UI copy only. */
export function isRegistrationOcrOperational(env: Record<string, string | undefined> = process.env): boolean {
  return getRegistrationDocumentReader(env) !== null;
}
