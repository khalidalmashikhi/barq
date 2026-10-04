import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// OCR engine selection is FAIL CLOSED: anything short of a complete, valid configuration means
// "no engine" — no document is sent anywhere and photos/scans stay on the manual path.

vi.mock("server-only", () => ({}));

const { getRegistrationDocumentReader, isRegistrationOcrOperational, resolveRegistrationOcrProvider } = await import("./get-registration-document-reader");
const { envSchema } = await import("../../../../../scripts/env-schema");

const KEY = "test-key-not-a-real-credential";

describe("getRegistrationDocumentReader — fail closed", () => {
  it.each([
    ["nothing set", {}],
    ["explicitly disabled", { REGISTRATION_OCR_PROVIDER: "disabled", ANTHROPIC_API_KEY: KEY }],
    ["a key but no provider selected", { ANTHROPIC_API_KEY: KEY }],
    ["provider selected but no key", { REGISTRATION_OCR_PROVIDER: "claude" }],
    ["provider selected with a blank key", { REGISTRATION_OCR_PROVIDER: "claude", ANTHROPIC_API_KEY: "   " }],
    ["an unknown provider name", { REGISTRATION_OCR_PROVIDER: "tesseract", ANTHROPIC_API_KEY: KEY }],
    ["a differently-cased provider name", { REGISTRATION_OCR_PROVIDER: "Claude", ANTHROPIC_API_KEY: KEY }],
    ["a malformed model override", { REGISTRATION_OCR_PROVIDER: "claude", ANTHROPIC_API_KEY: KEY, REGISTRATION_OCR_MODEL: "gpt-4o; rm -rf" }],
    ["a non-Claude model override", { REGISTRATION_OCR_PROVIDER: "claude", ANTHROPIC_API_KEY: KEY, REGISTRATION_OCR_MODEL: "some-other-model" }],
  ])("%s → no reader, OCR not operational", (_label, env) => {
    expect(getRegistrationDocumentReader(env)).toBeNull();
    expect(isRegistrationOcrOperational(env)).toBe(false);
  });

  it("a complete configuration yields the Claude reader with the default model", () => {
    const reader = getRegistrationDocumentReader({ REGISTRATION_OCR_PROVIDER: "claude", ANTHROPIC_API_KEY: KEY });
    expect(reader).not.toBeNull();
    expect(reader!.engine).toMatch(/^claude-vision\/claude-sonnet-5-5\/p\d+$/);
    expect(JSON.stringify(reader)).not.toContain(KEY); // the reader object exposes no secret
    expect(isRegistrationOcrOperational({ REGISTRATION_OCR_PROVIDER: "claude", ANTHROPIC_API_KEY: KEY })).toBe(true);
  });

  it("a valid model override is used", () => {
    const reader = getRegistrationDocumentReader({ REGISTRATION_OCR_PROVIDER: "claude", ANTHROPIC_API_KEY: KEY, REGISTRATION_OCR_MODEL: "claude-haiku-4-5-20251001" });
    expect(reader!.engine).toContain("/claude-haiku-4-5-20251001/");
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
    return res.success ? [] : res.error.issues.filter((i) => ["REGISTRATION_OCR_PROVIDER", "ANTHROPIC_API_KEY", "REGISTRATION_OCR_MODEL"].includes(String(i.path[0])));
  };

  it("defaults to disabled and needs no credential", () => {
    expect(issuesFor({})).toEqual([]);
    const parsed = envSchema.safeParse(base);
    if (parsed.success) expect(parsed.data.REGISTRATION_OCR_PROVIDER).toBe("disabled");
  });

  it("selecting claude WITHOUT a key fails validation at startup", () => {
    const issues = issuesFor({ REGISTRATION_OCR_PROVIDER: "claude" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: ["ANTHROPIC_API_KEY"], message: "required when REGISTRATION_OCR_PROVIDER=claude" });
  });

  it("claude with a key is valid; an unknown provider or a malformed model is rejected", () => {
    expect(issuesFor({ REGISTRATION_OCR_PROVIDER: "claude", ANTHROPIC_API_KEY: KEY })).toEqual([]);
    expect(issuesFor({ REGISTRATION_OCR_PROVIDER: "google" }).map((i) => i.path[0])).toEqual(["REGISTRATION_OCR_PROVIDER"]);
    expect(issuesFor({ REGISTRATION_OCR_MODEL: "not a model" }).map((i) => i.path[0])).toEqual(["REGISTRATION_OCR_MODEL"]);
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
    expect(example).not.toMatch(/sk-ant-/);
  });

  it("the vendor reader is constructed ONLY by the factory, and the factory is used only by the extraction service and the two upload pages (for honest copy)", () => {
    const makers = sources.filter((f) => /createClaudeVisionRegistrationReader\(/.test(read(f)) && !f.endsWith("claude-vision-reader.ts"));
    expect(makers).toEqual(["src/lib/vehicles/registration-extraction/ocr/get-registration-document-reader.ts"]);
    const users = sources.filter((f) => /get-registration-document-reader/.test(read(f)) && !f.endsWith("get-registration-document-reader.ts")).sort();
    expect(users).toEqual([
      "src/app/[locale]/provider/vehicles/new/[vehicleId]/page.tsx",
      "src/app/[locale]/provider/vehicles/new/page.tsx",
      "src/lib/vehicles/registration-extraction/extract-registration-service.ts",
    ]);
  });
});
