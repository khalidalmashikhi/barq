import "server-only";
import { createClaudeVisionRegistrationReader } from "./claude-vision-reader";
import {
  DEFAULT_REGISTRATION_OCR_MODEL,
  REGISTRATION_OCR_POLICY_VERSION_PATTERN,
  isAllowedRegistrationOcrModel,
  isRegistrationOcrInferenceGeo,
  type RegistrationOcrInferenceGeo,
  type RegistrationOcrModel,
} from "./ocr-model-allowlist";
import { REGISTRATION_OCR_PROCESSOR, REGISTRATION_OCR_PURPOSE } from "../constants";
import type { RegistrationDocumentReader } from "./registration-document-reader";

// Phase 3C (registration OCR) — resolves the OCR engine for THIS environment, FAIL CLOSED.
//
//   REGISTRATION_OCR_PROVIDER                "disabled" (default) | "claude"
//   ANTHROPIC_API_KEY                        required when the provider is "claude" (server-only secret)
//   REGISTRATION_OCR_INFERENCE_GEO           required when "claude": "us" | "global" — NO default. The
//                                            deployment must choose where inference runs; the reader
//                                            sends it on every request and verifies the vendor's answer.
//   REGISTRATION_OCR_PRIVACY_POLICY_VERSION  required when "claude": the version token of the processing
//                                            notice providers are shown. Every consent is bound to it;
//                                            changing it makes every earlier consent STALE.
//   REGISTRATION_OCR_MODEL                   optional; must be on the model ALLOWLIST (ocr-model-allowlist.ts)
//
// Anything that is not a complete, valid configuration yields `null`: no document is sent anywhere,
// photos and scans stay on the manual path, and the UI says automatic reading is unavailable. An
// unknown provider name, a missing key, a missing geography or policy version, or a model outside
// the allowlist never falls back to "some" engine, "some" geography or "some" policy.
// The configuration is read on every call (cheap) so a deployment's env change needs no code path.
//
// Switching this on is NOT a configuration tweak: the operational gate in
// docs/project-memory/23-REGISTRATION-OCR-PRIVACY-GATE.md must be completed first.

export type RegistrationOcrProvider = "disabled" | "claude";

export function resolveRegistrationOcrProvider(env: Record<string, string | undefined> = process.env): RegistrationOcrProvider {
  return env.REGISTRATION_OCR_PROVIDER === "claude" ? "claude" : "disabled";
}

/** The complete, validated OCR configuration — including the secret. Server-internal only. */
export type RegistrationOcrConfig = {
  provider: "claude";
  apiKey: string;
  model: RegistrationOcrModel;
  inferenceGeo: RegistrationOcrInferenceGeo;
  policyVersion: string;
};

export function getRegistrationOcrConfig(env: Record<string, string | undefined> = process.env): RegistrationOcrConfig | null {
  if (resolveRegistrationOcrProvider(env) !== "claude") return null;
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null; // selected but not credentialed → not operational
  const inferenceGeo = env.REGISTRATION_OCR_INFERENCE_GEO?.trim();
  if (!isRegistrationOcrInferenceGeo(inferenceGeo)) return null; // no geography chosen → nothing is sent anywhere
  const policyVersion = env.REGISTRATION_OCR_PRIVACY_POLICY_VERSION?.trim();
  if (!policyVersion || !REGISTRATION_OCR_POLICY_VERSION_PATTERN.test(policyVersion)) return null; // no notice version → no consent can be bound → no call
  const requestedModel = env.REGISTRATION_OCR_MODEL?.trim();
  if (requestedModel && !isAllowedRegistrationOcrModel(requestedModel)) return null; // a model outside the allowlist is a misconfiguration, not a hint
  return { provider: "claude", apiKey, model: requestedModel && isAllowedRegistrationOcrModel(requestedModel) ? requestedModel : DEFAULT_REGISTRATION_OCR_MODEL, inferenceGeo, policyVersion };
}

/** What the provider is told and what each consent is bound to. NEVER includes the key. */
export type RegistrationOcrPolicy = {
  processor: string;
  purpose: string;
  policyVersion: string;
  inferenceGeo: RegistrationOcrInferenceGeo;
};

export function getRegistrationOcrPolicy(env: Record<string, string | undefined> = process.env): RegistrationOcrPolicy | null {
  const config = getRegistrationOcrConfig(env);
  if (!config) return null;
  return { processor: REGISTRATION_OCR_PROCESSOR, purpose: REGISTRATION_OCR_PURPOSE, policyVersion: config.policyVersion, inferenceGeo: config.inferenceGeo };
}

export function getRegistrationDocumentReader(env: Record<string, string | undefined> = process.env): RegistrationDocumentReader | null {
  const config = getRegistrationOcrConfig(env);
  if (!config) return null;
  return createClaudeVisionRegistrationReader({ apiKey: config.apiKey, model: config.model, inferenceGeo: config.inferenceGeo });
}

/** Whether photos and scans can be read automatically here. For honest UI copy only. */
export function isRegistrationOcrOperational(env: Record<string, string | undefined> = process.env): boolean {
  return getRegistrationOcrConfig(env) !== null;
}
