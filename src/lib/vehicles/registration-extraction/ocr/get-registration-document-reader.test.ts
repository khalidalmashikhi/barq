import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// OCR engine selection is FAIL CLOSED: anything short of a complete, valid configuration means
// "no engine" — no document is sent anywhere and photos/scans stay on the manual path.

vi.mock("server-only", () => ({}));

const { getRegistrationDocumentReader, isRegistrationOcrOperational, resolveRegistrationOcrProvider, getRegistrationOcrConfig, getRegistrationOcrPolicy } = await import("./get-registration-document-reader");
const { REGISTRATION_OCR_MODEL_ALLOWLIST } = await import("./ocr-model-allowlist");
const { envSchema } = await import("../../../../../scripts/env-schema");

const KEY = "test-key-not-a-real-credential";
/** A COMPLETE configuration: provider + key + an explicit geography + the notice version. */
const COMPLETE = { REGISTRATION_OCR_PROVIDER: "claude", ANTHROPIC_API_KEY: KEY, REGISTRATION_OCR_INFERENCE_GEO: "us", REGISTRATION_OCR_PRIVACY_POLICY_VERSION: "2026-10-vehicle-ocr-v1" };

describe("getRegistrationDocumentReader — fail closed", () => {
  it.each([
    ["nothing set", {}],
    ["explicitly disabled", { REGISTRATION_OCR_PROVIDER: "disabled", ANTHROPIC_API_KEY: KEY }],
    ["a key but no provider selected", { ANTHROPIC_API_KEY: KEY }],
    ["provider selected but no key", { REGISTRATION_OCR_PROVIDER: "claude" }],
    ["provider selected with a blank key", { REGISTRATION_OCR_PROVIDER: "claude", ANTHROPIC_API_KEY: "   " }],
    ["an unknown provider name", { REGISTRATION_OCR_PROVIDER: "tesseract", ANTHROPIC_API_KEY: KEY }],
    ["a differently-cased provider name", { REGISTRATION_OCR_PROVIDER: "Claude", ANTHROPIC_API_KEY: KEY }],
    ["a malformed model override", { ...COMPLETE, REGISTRATION_OCR_MODEL: "gpt-4o; rm -rf" }],
    ["a non-Claude model override", { ...COMPLETE, REGISTRATION_OCR_MODEL: "some-other-model" }],
    ["a Claude model OUTSIDE the allowlist (Haiku 4.5 — no inference geography support)", { ...COMPLETE, REGISTRATION_OCR_MODEL: "claude-haiku-4-5-20251001" }],
    ["a Covered Model (30-day retention required, not available under ZDR)", { ...COMPLETE, REGISTRATION_OCR_MODEL: "claude-fable-5-1" }],
    ["provider + key but NO inference geography (the vendor default would be global routing)", { REGISTRATION_OCR_PROVIDER: "claude", ANTHROPIC_API_KEY: KEY, REGISTRATION_OCR_PRIVACY_POLICY_VERSION: "v1" }],
    ["an unknown inference geography", { ...COMPLETE, REGISTRATION_OCR_INFERENCE_GEO: "eu" }],
    ["a differently-cased inference geography", { ...COMPLETE, REGISTRATION_OCR_INFERENCE_GEO: "US" }],
    ["provider + key + geography but NO processing-notice version (no consent could be bound)", { REGISTRATION_OCR_PROVIDER: "claude", ANTHROPIC_API_KEY: KEY, REGISTRATION_OCR_INFERENCE_GEO: "us" }],
    ["a malformed notice version", { ...COMPLETE, REGISTRATION_OCR_PRIVACY_POLICY_VERSION: "v1 with spaces; DROP" }],
    ["a blank notice version", { ...COMPLETE, REGISTRATION_OCR_PRIVACY_POLICY_VERSION: "   " }],
  ])("%s → no reader, OCR not operational, no policy", (_label, env) => {
    expect(getRegistrationDocumentReader(env)).toBeNull();
    expect(isRegistrationOcrOperational(env)).toBe(false);
    expect(getRegistrationOcrConfig(env)).toBeNull();
    expect(getRegistrationOcrPolicy(env)).toBeNull();
  });

  it("a complete configuration yields the Claude reader with the default model, pinned to the configured geography", () => {
    const reader = getRegistrationDocumentReader(COMPLETE);
    expect(reader).not.toBeNull();
    expect(reader!.engine).toMatch(/^claude-vision\/claude-sonnet-5-5\/p\d+$/);
    expect(reader!.inferenceGeo).toBe("us");
    expect(JSON.stringify(reader)).not.toContain(KEY); // the reader object exposes no secret
    expect(isRegistrationOcrOperational(COMPLETE)).toBe(true);
    expect(getRegistrationDocumentReader({ ...COMPLETE, REGISTRATION_OCR_INFERENCE_GEO: "global" })!.inferenceGeo).toBe("global"); // explicit global is allowed — implicit never
  });

  it.each(REGISTRATION_OCR_MODEL_ALLOWLIST)("an allowlisted model override (%s) is used", (model) => {
    const reader = getRegistrationDocumentReader({ ...COMPLETE, REGISTRATION_OCR_MODEL: model });
    expect(reader!.engine).toContain(`/${model}/`);
  });

  it("the policy the provider is shown (and consents to) carries the processor, purpose, notice version and geography — never the key or the model", () => {
    const policy = getRegistrationOcrPolicy(COMPLETE);
    expect(policy).toEqual({ processor: "anthropic", purpose: "VEHICLE_REGISTRATION_READING", policyVersion: "2026-10-vehicle-ocr-v1", inferenceGeo: "us" });
    expect(JSON.stringify(policy)).not.toMatch(/claude|sonnet|test-key/i);
  });

  it("the provider name resolves to exactly 'claude' or 'disabled'", () => {
    expect(resolveRegistrationOcrProvider({ REGISTRATION_OCR_PROVIDER: "claude" })).toBe("claude");
    for (const v of [undefined, "", "disabled", "CLAUDE", "openai", "true"]) expect(resolveRegistrationOcrProvider({ REGISTRATION_OCR_PROVIDER: v })).toBe("disabled");
  });
});

describe("environment schema — the OCR keys", () => {
  const base = { DATABASE_URL: "postgresql://localhost/x", BETTER_AUTH_SECRET: "s", BETTER_AUTH_URL: "https://barq.test", NEXT_PUBLIC_BETTER_AUTH_URL: "https://barq.test" };
  const issuesFor = (extra: Record<string, string>) => {
    const res = envSchema.safeParse({ ...base, ...extra });
    return res.success ? [] : res.error.issues.filter((i) => ["REGISTRATION_OCR_PROVIDER", "ANTHROPIC_API_KEY", "REGISTRATION_OCR_MODEL", "REGISTRATION_OCR_INFERENCE_GEO", "REGISTRATION_OCR_PRIVACY_POLICY_VERSION"].includes(String(i.path[0])));
  };
  const COMPLETE_ENV = { REGISTRATION_OCR_PROVIDER: "claude", ANTHROPIC_API_KEY: KEY, REGISTRATION_OCR_INFERENCE_GEO: "us", REGISTRATION_OCR_PRIVACY_POLICY_VERSION: "2026-10-vehicle-ocr-v1" };

  it("defaults to disabled and needs no credential", () => {
    expect(issuesFor({})).toEqual([]);
    const parsed = envSchema.safeParse(base);
    if (parsed.success) expect(parsed.data.REGISTRATION_OCR_PROVIDER).toBe("disabled");
  });

  it("selecting claude WITHOUT the key, the geography and the notice version fails validation at startup — one issue each", () => {
    const issues = issuesFor({ REGISTRATION_OCR_PROVIDER: "claude" });
    expect(issues.map((i) => i.path[0]).sort()).toEqual(["ANTHROPIC_API_KEY", "REGISTRATION_OCR_INFERENCE_GEO", "REGISTRATION_OCR_PRIVACY_POLICY_VERSION"]);
    expect(issues.find((i) => i.path[0] === "ANTHROPIC_API_KEY")).toMatchObject({ message: "required when REGISTRATION_OCR_PROVIDER=claude" });
    expect(issues.find((i) => i.path[0] === "REGISTRATION_OCR_INFERENCE_GEO")!.message).toMatch(/no default/);
  });

  it("a key alone is not enough: the geography and the notice version are each required on their own", () => {
    expect(issuesFor({ REGISTRATION_OCR_PROVIDER: "claude", ANTHROPIC_API_KEY: KEY }).map((i) => i.path[0]).sort()).toEqual(["REGISTRATION_OCR_INFERENCE_GEO", "REGISTRATION_OCR_PRIVACY_POLICY_VERSION"]);
    const { REGISTRATION_OCR_INFERENCE_GEO: _geo, ...noGeo } = COMPLETE_ENV;
    void _geo;
    expect(issuesFor(noGeo).map((i) => i.path[0])).toEqual(["REGISTRATION_OCR_INFERENCE_GEO"]);
    const { REGISTRATION_OCR_PRIVACY_POLICY_VERSION: _ver, ...noVersion } = COMPLETE_ENV;
    void _ver;
    expect(issuesFor(noVersion).map((i) => i.path[0])).toEqual(["REGISTRATION_OCR_PRIVACY_POLICY_VERSION"]);
  });

  it("a complete claude configuration is valid; an unknown provider, geography, model or malformed notice version is rejected", () => {
    expect(issuesFor(COMPLETE_ENV)).toEqual([]);
    expect(issuesFor({ ...COMPLETE_ENV, REGISTRATION_OCR_INFERENCE_GEO: "global" })).toEqual([]);
    expect(issuesFor({ REGISTRATION_OCR_PROVIDER: "google" }).map((i) => i.path[0])).toEqual(["REGISTRATION_OCR_PROVIDER"]);
    expect(issuesFor({ REGISTRATION_OCR_MODEL: "not a model" }).map((i) => i.path[0])).toEqual(["REGISTRATION_OCR_MODEL"]);
    expect(issuesFor({ REGISTRATION_OCR_MODEL: "claude-haiku-4-5-20251001" }).map((i) => i.path[0])).toEqual(["REGISTRATION_OCR_MODEL"]); // outside the allowlist
    expect(issuesFor({ ...COMPLETE_ENV, REGISTRATION_OCR_INFERENCE_GEO: "eu" }).map((i) => i.path[0])).toEqual(["REGISTRATION_OCR_INFERENCE_GEO"]);
    expect(issuesFor({ ...COMPLETE_ENV, REGISTRATION_OCR_PRIVACY_POLICY_VERSION: "has spaces" }).map((i) => i.path[0])).toEqual(["REGISTRATION_OCR_PRIVACY_POLICY_VERSION"]);
  });
});

describe("the OCR secret never reaches the browser, the repository or another subsystem", () => {
  const ROOT = process.cwd();
  const walk = (dir: string): string[] =>
    readdirSync(path.join(ROOT, dir), { recursive: true, encoding: "utf8" })
      .map((f) => `${dir}/${f.replace(/\\/g, "/")}`)
      .filter((f) => /\.(ts|tsx)$/.test(f));
  const sources = walk("src").filter((f) => !/\.test\.(ts|tsx)$/.test(f));
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

  it("ANTHROPIC_API_KEY is read in exactly one place — the server-only reader factory", () => {
    expect(sources.filter((f) => read(f).includes("ANTHROPIC_API_KEY"))).toEqual(["src/lib/vehicles/registration-extraction/ocr/get-registration-document-reader.ts"]);
    expect(read("src/lib/vehicles/registration-extraction/ocr/get-registration-document-reader.ts")).toMatch(/^import "server-only";/);
  });

  it("no NEXT_PUBLIC_ variable carries OCR configuration, and no client component imports the OCR modules' server code", () => {
    for (const f of sources) {
      const text = read(f);
      expect(text, f).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(ANTHROPIC|OCR)/);
      if (/^["']use client["'];/m.test(text)) expect(text, f).not.toMatch(/registration-extraction\/ocr\/(claude-vision-reader|get-registration-document-reader)|extract-registration-service/);
    }
  });

  it("the committed example env ships EMPTY placeholders (no credential in the repository)", () => {
    const example = read(".env.example");
    expect(example).toMatch(/^REGISTRATION_OCR_PROVIDER=disabled$/m);
    expect(example).toMatch(/^ANTHROPIC_API_KEY=$/m);
    expect(example).toMatch(/^REGISTRATION_OCR_MODEL=$/m);
    expect(example).toMatch(/^REGISTRATION_OCR_INFERENCE_GEO=$/m);
    expect(example).toMatch(/^REGISTRATION_OCR_PRIVACY_POLICY_VERSION=$/m);
    expect(example).not.toMatch(/sk-ant-/);
  });

  it("the vendor reader is constructed ONLY by the factory, and the factory is used only by the extraction service, the consent/review layer and the two upload pages (for honest copy)", () => {
    const makers = sources.filter((f) => /createClaudeVisionRegistrationReader\(/.test(read(f)) && !f.endsWith("claude-vision-reader.ts"));
    expect(makers).toEqual(["src/lib/vehicles/registration-extraction/ocr/get-registration-document-reader.ts"]);
    const users = sources.filter((f) => /get-registration-document-reader/.test(read(f)) && !f.endsWith("get-registration-document-reader.ts")).sort();
    expect(users).toEqual([
      "src/app/[locale]/provider/vehicles/new/[vehicleId]/page.tsx",
      "src/app/[locale]/provider/vehicles/new/page.tsx",
      "src/lib/vehicles/registration-extraction/extract-registration-service.ts",
      "src/lib/vehicles/registration-extraction/ocr/ocr-consent.ts",
      "src/lib/vehicles/registration-review/decide-ocr-consent.ts",
      "src/lib/vehicles/registration-review/get-registration-review.ts",
    ]);
    // Of those, only the factory itself and the service may hold the secret-bearing config; the
    // review/consent layer sees the POLICY (no key) only.
    for (const f of ["src/lib/vehicles/registration-review/decide-ocr-consent.ts", "src/lib/vehicles/registration-review/get-registration-review.ts", "src/lib/vehicles/registration-extraction/ocr/ocr-consent.ts", "src/app/[locale]/provider/vehicles/new/[vehicleId]/page.tsx", "src/app/[locale]/provider/vehicles/new/page.tsx"]) {
      expect(read(f), f).not.toMatch(/getRegistrationOcrConfig|apiKey/);
    }
  });
});
