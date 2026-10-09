import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { toPublicVehicle, type VehicleWithAsset } from "@/lib/vehicles/vehicle-dto";
import { buildBookingVehicleSnapshot, parseBookingVehicleSnapshot } from "@/lib/booking/booking-vehicle-snapshot";

// PUBLIC-SURFACE PRIVACY REGRESSION (Phase 3C registration OCR).
//
// OCR can now read more of a registration document than before. NONE of it may widen what a
// customer can see. The customer-visible vehicle facts are, and stay, exactly: make/model, model
// year, colour, vehicle type, approved passenger capacity, the public description and the TRUSTED
// 4x4 flag. Registration number, chassis/VIN, engine number, expiry and every regulatory date,
// the document itself, its storage key and checksum, the OCR engine, the onboarding request and
// its key remain private to the provider and authorized BARQ staff.
//
// Two kinds of proof: (1) the public DTO builders, fed a row STUFFED with private data, return
// only the allowlist; (2) no public read model or public API route even references a private
// registration field, relation or table.

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
/** Code only — comments may (and do) NAME a private field in order to say it is excluded. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .map((l) => l.replace(/\s\/\/.*$/, ""))
    .join("\n");

const PRIVATE_VALUES = {
  registrationNumber: "T 99001",
  vin: "TESTV1N0000000001",
  engineNumber: "ENG-000111",
  licenseExpiry: "2027-05-31",
  licenseExpiryDate: "2027-05-31",
  firstRegistrationDate: "2020-01-15",
  licenseValidFrom: "2026-06-01",
  plateNumber: "T 99001",
  plateType: "PRIVATE-PLATE-TYPE",
  extractedVin: "TESTV1N0000000001",
  extractedPlateNumber: "T 99001",
  documentSha256: "0f".repeat(32),
  ocrEngine: "claude-vision/model/p1",
  ocrInferenceGeo: "us",
  ocrCallCount: 3,
  processingToken: "11111111-2222-3333-4444-555555555555",
  policyVersion: "2026-10-vehicle-ocr-v1",
  ownerAuthorizationConfirmed: true,
  objectKey: "asset-documents/asset-1/vehicle_registration/secret.jpg",
  originalFilename: "my-registration-photo.jpg",
  idempotencyKey: "onboarding-request-key-1",
  onboardingRequestKey: "onboarding-request-key-1",
  ownerName: "Synthetic Person",
  civilNumber: "12345678",
  address: "Synthetic Street 1",
  registeredSeats: 14,
  licensedPassengerCapacity: 15,
  claimedFourByFour: true,
};

const stuffedRow = {
  assetId: "asset-1",
  make: "Toyota",
  model: "Testcruiser",
  modelYear: 2020,
  color: "White",
  vehicleType: "SUV",
  bookablePassengerCapacity: 6,
  publicDescription: "A synthetic vehicle.",
  fourByFourVerified: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  asset: { status: "ACTIVE", providerId: "prov-1", verificationStatus: "APPROVED" },
  registrationExtraction: { fields: { vin: { rawValue: "TESTV1N0000000001" } }, status: "NEEDS_REVIEW", source: "OCR" },
  registrationConfirmations: [{ vin: "TESTV1N0000000001", plateNumber: "T 99001" }],
  onboardingRequest: { idempotencyKey: "onboarding-request-key-1" },
  registrationOcrConsents: [{ decision: "GRANTED", policyVersion: "2026-10-vehicle-ocr-v1", processor: "anthropic", userId: "user-1", locale: "ar" }],
  documents: [{ objectKey: "asset-documents/asset-1/vehicle_registration/secret.jpg" }],
  ...PRIVATE_VALUES,
} as unknown as VehicleWithAsset;

describe("public vehicle DTO — exactly the customer allowlist, whatever the row carries", () => {
  it("returns ONLY the allowlisted keys", () => {
    expect(Object.keys(toPublicVehicle(stuffedRow)).sort()).toEqual(["color", "id", "isFourByFour", "make", "model", "modelYear", "passengerCapacity", "publicDescription", "vehicleType"]);
  });

  it("carries NO private registration value or key — not the plate, VIN, dates, document, OCR or request data", () => {
    const raw = JSON.stringify(toPublicVehicle(stuffedRow));
    for (const [key, value] of Object.entries(PRIVATE_VALUES)) {
      expect(raw, key).not.toContain(`"${key}"`);
      if (typeof value === "string") expect(raw, key).not.toContain(value);
    }
    for (const relation of ["registrationExtraction", "registrationConfirmations", "onboardingRequest", "documents"]) expect(raw).not.toContain(relation);
  });

  it("the approved passenger capacity is the BOOKABLE one — never the registered seats or the licensed capacity read from the document", () => {
    const dto = toPublicVehicle(stuffedRow);
    expect(dto.passengerCapacity).toBe(6);
    expect(JSON.stringify(dto)).not.toMatch(/\b1[45]\b/);
  });

  it("the provider's own 4x4 CLAIM never becomes the customer-visible flag", () => {
    expect(toPublicVehicle(stuffedRow).isFourByFour).toBe(false); // claimedFourByFour is true, fourByFourVerified is not
  });
});

describe("booking / customer vehicle snapshot — the same allowlist", () => {
  const source = { ...(stuffedRow as unknown as Record<string, unknown>) } as unknown as Parameters<typeof buildBookingVehicleSnapshot>[0];

  it("is built from the allowlisted facts only", () => {
    const snapshot = buildBookingVehicleSnapshot(source);
    expect(Object.keys(snapshot).sort()).toEqual(["color", "isFourByFour", "make", "model", "modelYear", "passengerCapacity", "vehicleType"]);
    const raw = JSON.stringify(snapshot);
    for (const [key, value] of Object.entries(PRIVATE_VALUES)) {
      expect(raw, key).not.toContain(`"${key}"`);
      if (typeof value === "string") expect(raw, key).not.toContain(value);
    }
  });

  it("a stored snapshot that somehow carried a private key is REJECTED on read (strict schema), not shown", () => {
    const good = buildBookingVehicleSnapshot(source);
    expect(parseBookingVehicleSnapshot(good)).toEqual(good);
    for (const leak of ["registrationNumber", "vin", "licenseExpiry", "objectKey", "extractedPlateNumber"]) {
      expect(parseBookingVehicleSnapshot({ ...good, [leak]: "x" }), leak).toBeNull();
    }
  });
});

// ── structural: public readers never touch the private registration surface ─────────────────────
const PRIVATE_TOKENS =
  /registrationExtraction|registrationConfirmation|vehicleRegistrationExtraction|vehicleRegistrationConfirmation|vehicleOnboardingRequest|onboardingRequest\b|registrationOcrConsent|vehicleRegistrationOcrConsent|OcrConsent|ocrInferenceGeo|ocrCallCount|ownerAuthorizationConfirmed|policyVersion|extractedVin|extractedPlateNumber|extractedManufactureYear|extractedLicensedPassengerCapacity|licenseExpiryDate|licenseExpiry|firstRegistrationDate|licenseValidFrom|engineNumber|plateNumber|documentSha256|ocrEngine|processingToken|idempotencyKey|assetDocument|objectKey|originalFilename|registration-extraction|registration-review|onboarding\/|VEHICLE_REGISTRATION_BACK|registration-document-set|REGISTRATION_BACK_TYPE|REGISTRATION_SET_TYPES|documentDescription|vehicleTypeSuggestion|HEURISTIC_SPLIT|vehicle-description/;

/** Customer-facing read models: discovery, service detail, search/browse, provider profile, rental
 *  calendar, public vehicle, public tour vehicles, and the vehicle snapshot stored on a booking. */
const PUBLIC_READ_MODELS = [
  "src/lib/discovery/get-home-discovery.ts",
  "src/lib/services/get-service-detail.ts",
  "src/lib/services/get-services.ts",
  "src/lib/services/get-provider-profile.ts",
  "src/lib/offerings/rental/resolve-rental-service-calendar.ts",
  "src/lib/vehicles/queries/get-public-vehicle.ts",
  "src/lib/tour-template/vehicle-pool/public-tour-vehicles.ts",
  "src/lib/booking/booking-vehicle-snapshot.ts",
];

/** Every PUBLIC (non-/me) API v1 route handler. */
const publicApiRoutes = readdirSync(path.join(ROOT, "src/app/api/v1"), { recursive: true, encoding: "utf8" })
  .map((f) => `src/app/api/v1/${f.replace(/\\/g, "/")}`)
  .filter((f) => f.endsWith("/route.ts") && !f.includes("/me/"));

describe("public read models and public API routes never reference private registration data", () => {
  it("the audited set is what this guard believes it is", () => {
    for (const file of PUBLIC_READ_MODELS) expect(existsSync(path.join(ROOT, file)), file).toBe(true);
    expect(publicApiRoutes).toEqual(
      expect.arrayContaining([
        "src/app/api/v1/discovery/home/route.ts",
        "src/app/api/v1/services/route.ts",
        "src/app/api/v1/services/[id]/route.ts",
        "src/app/api/v1/services/[id]/rental-calendar/route.ts",
        "src/app/api/v1/providers/[idOrSlug]/route.ts",
      ]),
    );
  });

  it.each(PUBLIC_READ_MODELS)("%s — no private registration field, relation, table or module", (file) => {
    expect(code(file)).not.toMatch(PRIVATE_TOKENS);
  });

  it.each(publicApiRoutes)("%s — no private registration field, relation, table or module", (file) => {
    expect(code(file)).not.toMatch(PRIVATE_TOKENS);
  });

  it.each([...PUBLIC_READ_MODELS, ...publicApiRoutes])("%s — never selects the registration number or VIN", (file) => {
    expect(code(file)).not.toMatch(/registrationNumber|\bvin\b/);
  });

  it("the customer-facing API DTO for a vehicle is derived from the public DTO, and the ONE DTO that carries a plate is the provider's assigned-vehicle view", () => {
    const dtos = code("src/lib/api/v1/dtos.ts");
    expect(dtos).not.toMatch(/registrationExtraction|registrationConfirmation|vehicleOnboardingRequest|extractedVin|extractedPlateNumber|licenseExpiry|engineNumber|documentSha256|ocrEngine|idempotencyKey|\bvin\b|OcrConsent|ocrInferenceGeo|policyVersion/);
    // registrationNumber appears only in the provider-assigned-vehicle DTO (its type + its mapper).
    const lines = dtos.split("\n").filter((l) => l.includes("registrationNumber"));
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const l of lines) expect(l).toMatch(/registrationNumber: (string \| null|v\.registrationNumber)|registrationNumber: v\.registrationNumber/);
  });

  it("the private registration tables are read ONLY inside the vehicle registration domain and the provider/admin vehicle pages", () => {
    const sources = readdirSync(path.join(ROOT, "src"), { recursive: true, encoding: "utf8" })
      .map((f) => `src/${f.replace(/\\/g, "/")}`)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f));
    const readers = sources.filter((f) => /vehicleRegistrationExtraction\.|registrationExtraction:|vehicleRegistrationConfirmation\.|vehicleOnboardingRequest\./.test(code(f)));
    for (const f of readers) {
      expect(f, f).toMatch(/^src\/lib\/vehicles\/(registration-extraction|registration-review|onboarding)\//);
    }
    expect(readers.length).toBeGreaterThan(3);
  });
});
