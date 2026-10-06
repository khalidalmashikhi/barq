// Phase 3C (registration OCR privacy gate) — the ONLY models the registration reader may be
// configured with. Pure (no server-only) so the environment schema and the factory share it.
//
// Why an allowlist instead of a pattern: the model decides which vendor controls apply.
//   • Every model here supports explicit inference geography (`inference_geo`), which this
//     integration REQUIRES — a model without it would silently run on global routing.
//   • Models designated "Covered Models" by the vendor (Claude Fable / Mythos) require 30-day data
//     retention and are not available under zero data retention; they are deliberately absent.
//   • Claude Haiku 4.5 does not support `inference_geo` (the request is rejected) and is absent.
// Adding a model is a privacy decision, not a configuration tweak: it goes through this file and
// the operational gate (docs/project-memory/23-REGISTRATION-OCR-PRIVACY-GATE.md).
export const REGISTRATION_OCR_MODEL_ALLOWLIST = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-sonnet-5", "claude-opus-5"] as const;

export type RegistrationOcrModel = (typeof REGISTRATION_OCR_MODEL_ALLOWLIST)[number];

export const DEFAULT_REGISTRATION_OCR_MODEL: RegistrationOcrModel = "claude-sonnet-5-5";

export function isAllowedRegistrationOcrModel(value: unknown): value is RegistrationOcrModel {
  return typeof value === "string" && (REGISTRATION_OCR_MODEL_ALLOWLIST as readonly string[]).includes(value);
}

/** The inference geographies the vendor offers. There is NO default: the deployment must choose. */
export const REGISTRATION_OCR_INFERENCE_GEOS = ["us", "global"] as const;
export type RegistrationOcrInferenceGeo = (typeof REGISTRATION_OCR_INFERENCE_GEOS)[number];

export function isRegistrationOcrInferenceGeo(value: unknown): value is RegistrationOcrInferenceGeo {
  return typeof value === "string" && (REGISTRATION_OCR_INFERENCE_GEOS as readonly string[]).includes(value);
}

/** Version token of the processing notice the provider is shown (and that consent is bound to). */
export const REGISTRATION_OCR_POLICY_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;
