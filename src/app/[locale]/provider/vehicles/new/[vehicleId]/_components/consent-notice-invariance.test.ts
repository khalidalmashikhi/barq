import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

// 2026-10-16 correction — why the notice version did NOT move with the vehicle-journey redesign.
//
// The processing-notice version (`REGISTRATION_OCR_PRIVACY_POLICY_VERSION`, Vercel env only — staging
// `2026-10-16-v1`) binds every consent to WHAT the provider was told and WHAT the consent means. The
// redesign changed visual hierarchy, headings and button wording only. This suite pins the parts that
// carry meaning to their content as deployed at `cf51c3a` (the deployment for which `2026-10-16-v1`
// was set): the disclosure strings in all 8 languages, the Privacy Policy's automatic-reading section,
// and the consent-semantics code (recording, binding, decision, reader configuration). If any hash
// changes, the change must be reviewed for a notice-version bump BEFORE the hash is updated here.
// Hashes are over LF-normalised text, so a Windows CRLF checkout does not matter.

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;

/** What the provider is told (ordinary workflow + privacy details + notices). Titles / buttons are not here. */
const DISCLOSURE_KEYS = [
  "vehicleRegConsentIntro",
  "vehicleRegConsentIntroPdf",
  "vehicleRegConsentIntroComplete",
  "vehicleRegConsentDisclosure",
  "vehicleRegConsentDetailsToggle",
  "vehicleRegConsentDetailsExternal",
  "vehicleRegConsentLimits",
  "vehicleRegConsentLegalNote",
  "vehicleRegConsentOwnerLabel",
  "vehicleRegConsentPrivacyPolicyLink",
  "vehicleRegConsentStaleNotice",
  "vehicleRegConsentDeclinedNotice",
];

const disclosureCanon = () =>
  JSON.stringify(
    LOCALES.map((l) => {
      const provider = JSON.parse(read(`messages/${l}/provider.json`)) as Record<string, string>;
      const pages = JSON.parse(read(`messages/${l}/pages.json`)) as { privacy: { automaticReading: unknown } };
      return [l, DISCLOSURE_KEYS.map((k) => [k, provider[k]]), pages.privacy.automaticReading];
    }),
  );

/** Content as deployed at cf51c3a (notice 2026-10-16-v1). */
const PINNED = {
  disclosure: "666a995fb01431efa09a5606f1c534f95b73c13fa916320151a4d84200254496",
  "src/lib/vehicles/registration-extraction/ocr/ocr-consent.ts": "4ea390e4cc052cf3a5475a575e7d03d22d0800ac035e27621d6cc1f3d2774825",
  "src/lib/vehicles/registration-review/decide-ocr-consent.ts": "7372af7b934c0168052fe57e8cc5d401078a4887717b104bb48451313053c439",
  "src/app/[locale]/provider/vehicles/new/[vehicleId]/consent-actions.ts": "4b548d18e455cc0f3ec75532eeca4130c5bb47aec0f4e877959c9c1e0bec31d3",
  "src/lib/vehicles/registration-extraction/ocr/get-registration-document-reader.ts": "6a6da2893b87fb030acec8466888d7dc640a44d52a62a9eacba9ff7c119b9afa",
} as const;

describe("10. consent semantics and the notice version are unchanged by the redesign", () => {
  it("the disclosure the provider is shown (8 languages) and the Privacy Policy's automatic-reading section are byte-identical to the 2026-10-16-v1 deployment", () => {
    for (const l of LOCALES) {
      const provider = JSON.parse(read(`messages/${l}/provider.json`)) as Record<string, string>;
      for (const k of DISCLOSURE_KEYS) expect(provider[k]?.trim().length ?? 0, `${l}.${k}`).toBeGreaterThan(0);
    }
    expect(sha256(disclosureCanon())).toBe(PINNED.disclosure);
  });

  it("consent recording, binding, decision and reader configuration are byte-identical to the 2026-10-16-v1 deployment", () => {
    for (const [file, hash] of Object.entries(PINNED)) {
      if (file === "disclosure") continue;
      expect(sha256(read(file)), file).toBe(hash);
    }
  });

  it("the consent step still grants only on the explicit tap, with the owner attestation, through the same actions", () => {
    const STEP = read("src/app/[locale]/provider/vehicles/new/[vehicleId]/_components/ocr-consent-step.tsx");
    expect(STEP).toContain("await grantOcrConsentAction(vehicleId, ownerAuthorized)");
    expect(STEP).toContain("await grantOcrConsentForCompletionAction(vehicleId, ownerAuthorized)");
    expect(STEP).toContain("await declineOcrConsentAction(vehicleId)");
    expect(STEP).toMatch(/if \(which === "read" && !ownerAuthorized\) return;/);
    expect(STEP).toMatch(/const \[ownerAuthorized, setOwnerAuthorized\] = useState\(false\);/);
    expect(STEP).not.toMatch(/useEffect/);
  });

  it("the notice version is configuration only: no code or example file pins or bumps it", () => {
    const READER = read("src/lib/vehicles/registration-extraction/ocr/get-registration-document-reader.ts");
    expect(READER).toMatch(/const policyVersion = env\.REGISTRATION_OCR_PRIVACY_POLICY_VERSION\?\.trim\(\);/);
    expect(read(".env.example")).toMatch(/^REGISTRATION_OCR_PRIVACY_POLICY_VERSION=$/m);
    for (const rel of [
      "src/app/[locale]/provider/vehicles/new/[vehicleId]/_components/ocr-consent-step.tsx",
      "src/app/[locale]/provider/vehicles/new/[vehicleId]/page.tsx",
      "src/components/provider/vehicle-journey/journey-steps.tsx",
      "src/components/provider/vehicle-journey/journey-status.tsx",
      "src/components/provider/vehicle-journey/journey-progress.ts",
    ]) {
      expect(read(rel), rel).not.toMatch(/\d{4}-\d{2}-\d{2}-v\d|PRIVACY_POLICY_VERSION/);
    }
  });
});
