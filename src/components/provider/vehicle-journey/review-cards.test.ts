import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CONFIRMATION_FIELDS, CONFIRMATION_FIELD_KEYS, SENSITIVE_FIELD_KEYS, type ConfirmationFieldKey } from "@/lib/vehicles/registration-review/field-model";
import { fieldStatus } from "@/lib/vehicles/registration-review/review-field-state";
import { CAPACITY_CARD_KEYS, CAPACITY_SHOWN_TO_CUSTOMERS, CUSTOMER_CARD_KEYS, PRIVATE_CARD_KEYS, isCardFieldShown, reviewCardOf, reviewReadiness } from "./review-cards";

// 2026-10-17 — the card-based vehicle review. The card assignment and the final card's readiness
// summary are pure (proven here); the form's use of them is asserted on its source (no DOM here).

const fetchGuard = vi.fn(() => {
  throw new Error("OUTBOUND REQUEST ATTEMPTED");
});
vi.stubGlobal("fetch", fetchGuard);
afterEach(() => expect(fetchGuard).not.toHaveBeenCalled());

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const FORM = read("src/app/[locale]/provider/vehicles/new/[vehicleId]/_components/onboarding-review-form.tsx");
const PAGE = read("src/app/[locale]/provider/vehicles/new/[vehicleId]/page.tsx");
const UI = read("src/components/provider/vehicle-journey/journey-ui.ts");
const CSS = read("src/app/globals.css");
const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
const messages = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(read(`messages/${l}/provider.json`)) as Record<string, string>]));

type F = { key: ConfirmationFieldKey; kind: "text" | "int" | "date" | "vin" | "plate"; extractedValue: string | number | null; confirmedValue: string | number | null; source: "NATIVE_PDF_TEXT" | "OCR" | "PROVIDER" | "UNRESOLVED"; required: boolean; needsReview: boolean };
const field = (key: ConfirmationFieldKey, over: Partial<F> = {}): F => ({ key, kind: CONFIRMATION_FIELDS[key].kind, extractedValue: null, confirmedValue: null, source: "UNRESOLVED", required: CONFIRMATION_FIELDS[key].required, needsReview: false, ...over });

describe("cards contain only fields of their classification", () => {
  it("the three field cards partition every confirmation field exactly once", () => {
    const all = [...CUSTOMER_CARD_KEYS, ...CAPACITY_CARD_KEYS, ...PRIVATE_CARD_KEYS];
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...CONFIRMATION_FIELD_KEYS].sort());
    for (const k of CONFIRMATION_FIELD_KEYS) expect(reviewCardOf(k)).toBe(CUSTOMER_CARD_KEYS.includes(k as never) ? "CUSTOMER" : CAPACITY_CARD_KEYS.includes(k as never) ? "CAPACITY" : "PRIVATE");
  });

  it("'Information shown to customers' holds ONLY customer-group fields: type (chosen), manufacturer, model, year, colour", () => {
    expect([...CUSTOMER_CARD_KEYS]).toEqual(["make", "model", "modelYear", "color"]);
    for (const k of CUSTOMER_CARD_KEYS) expect(CONFIRMATION_FIELDS[k].group, k).toBe("CUSTOMER");
  });

  it("public and private never cross: the private card holds only private-group fields and EVERY sensitive identifier", () => {
    for (const k of PRIVATE_CARD_KEYS) expect(CONFIRMATION_FIELDS[k].group, k).toBe("PRIVATE");
    for (const k of SENSITIVE_FIELD_KEYS) expect(reviewCardOf(k), k).toBe("PRIVATE");
    expect(PRIVATE_CARD_KEYS).toEqual(expect.arrayContaining(["plateNumber", "vin", "engineNumber", "licenseValidFrom", "licenseExpiry", "firstRegistrationDate", "plateType", "usageClassification"]));
  });

  it("capacity & operation: licensed and registered stay private-group; bookable is the ONLY value there customers see", () => {
    expect(CONFIRMATION_FIELDS.licensedPassengerCapacity.group).toBe("PRIVATE");
    expect(CONFIRMATION_FIELDS.registeredSeats.group).toBe("PRIVATE");
    expect(CAPACITY_SHOWN_TO_CUSTOMERS).toBe("bookablePassengerCapacity");
    expect(CONFIRMATION_FIELDS[CAPACITY_SHOWN_TO_CUSTOMERS].group).toBe("CUSTOMER");
    expect(CAPACITY_CARD_KEYS.filter((k) => CONFIRMATION_FIELDS[k].group === "CUSTOMER")).toEqual(["bookablePassengerCapacity"]);
  });

  it("registered seats appear only when the document or the provider gave a value; every other field always shows", () => {
    expect(isCardFieldShown(field("registeredSeats"), "")).toBe(false);
    expect(isCardFieldShown(field("registeredSeats", { extractedValue: 7 }), "")).toBe(true);
    expect(isCardFieldShown(field("registeredSeats", { confirmedValue: 7 }), "")).toBe(true);
    expect(isCardFieldShown(field("registeredSeats"), "7")).toBe(true);
    for (const k of CONFIRMATION_FIELD_KEYS.filter((x) => x !== "registeredSeats")) expect(isCardFieldShown(field(k), ""), k).toBe(true);
  });

  it("the form renders each card from its own list — customer, capacity, private — and tags capacity values honestly", () => {
    expect(FORM).toMatch(/const customer = useMemo\(\(\) => fieldsInCard\(fields, CUSTOMER_CARD_KEYS\), \[fields\]\);/);
    expect(FORM).toMatch(/const capacityFields = useMemo\(\(\) => fieldsInCard\(fields, CAPACITY_CARD_KEYS\), \[fields\]\);/);
    expect(FORM).toMatch(/const privateFields = useMemo\(\(\) => fieldsInCard\(fields, PRIVATE_CARD_KEYS\), \[fields\]\);/);
    const customerCard = FORM.slice(FORM.indexOf('aria-labelledby="of-customer-title"'), FORM.indexOf('aria-labelledby="of-capacity-title"'));
    expect(customerCard).toContain("customer.map((f) => renderField(f))");
    expect(customerCard).not.toMatch(/privateFields|capacityFields\.map/);
    const capacityCard = FORM.slice(FORM.indexOf('aria-labelledby="of-capacity-title"'), FORM.indexOf('aria-labelledby="of-private-title"'));
    expect(capacityCard).toMatch(/capacityFields\.filter\(\(f\) => isCardFieldShown\(f, values\[f\.key\]\)\)\.map\(\(f\) => renderField\(f, f\.key === CAPACITY_SHOWN_TO_CUSTOMERS \? "SHOWN" : "NOT_SHOWN"\)\)/);
    expect(capacityCard).toMatch(/vehicleType === "FOUR_BY_FOUR"/); // the 4x4 declaration lives with the capacity
    const privateCard = FORM.slice(FORM.indexOf('aria-labelledby="of-private-title"'), FORM.indexOf('id="of-publicDescription"'));
    expect(privateCard).toContain("privateFields.map((f) => renderField(f))");
    expect(privateCard).not.toMatch(/customer\.map|capacityFields/);
    // the customer card only ECHOES the bookable value (edited in the capacity card) — never a second input
    expect(customerCard).toMatch(/data-bookable-echo=""/);
    expect(customerCard).not.toMatch(/<input|renderField\(f, /);
  });
});

describe("sensitive values, provenance and actions are unchanged", () => {
  it("sensitive values stay masked until explicitly revealed; the private card starts collapsed", () => {
    expect(FORM).toMatch(/\{f\.sensitive && !isRevealed \? \(/);
    expect(FORM).toMatch(/\{maskSensitiveValue\(values\[f\.key\] \?\? ""\) \|\| "—"\}/);
    expect(FORM).toMatch(/const \[privateOpen, setPrivateOpen\] = useState\(false\);/);
    // a server error on a field of the PRIVATE card opens it; capacity fields are always visible
    expect(FORM).toMatch(/if \(privateKeys\.has\(first\.field\)\) setPrivateOpen\(true\);/);
  });

  it("every field keeps its honest provenance line (shared status row) — the cards add no status logic", () => {
    expect(FORM).toMatch(/const status = fieldState\.status\(f\);/);
    expect(FORM).toMatch(/<FieldStatusAndSuggestion field=\{f\} label=\{label\} status=\{status\} value=\{values\[f\.key\]\} pending=\{pending\} onApply=\{\(\) => applyFieldSuggestion\(f\)\} inputId=\{`of-\$\{f\.key\}`\} \/>/);
  });

  it("Create stays governed ONLY by the real validator; save / create / cancel are the same single calls", () => {
    expect(FORM).toMatch(/const canSubmit = localCheck\.ok && vehicleType !== "" && declaration && !pending;/);
    expect(FORM).toMatch(/onClick=\{finalize\} disabled=\{!canSubmit\}/);
    for (const action of ["saveOnboardingDraftAction(", "finalizeVehicleAction(", "cancelOnboardingAction("]) expect((FORM.match(new RegExp(action.replace("(", "\\("), "g")) ?? []).length, action).toBe(1);
    // the readiness summary never feeds canSubmit
    expect(FORM.slice(FORM.indexOf("const canSubmit"), FORM.indexOf("const canSubmit") + 120)).not.toMatch(/readiness/);
  });
});

describe("the final card's readiness summary", () => {
  const fields = [
    field("make", { extractedValue: "Mazda", source: "NATIVE_PDF_TEXT", needsReview: true }),
    field("model"),
    field("modelYear", { extractedValue: 2019, source: "NATIVE_PDF_TEXT" }),
    field("color", { extractedValue: "أبيض", source: "NATIVE_PDF_TEXT" }),
    field("bookablePassengerCapacity"),
    field("licensedPassengerCapacity", { extractedValue: 5, source: "OCR", needsReview: true }),
    field("plateNumber", { extractedValue: "SYN-0001", source: "OCR" }),
    field("vin"),
    field("licenseExpiry", { extractedValue: "2027-05-31", source: "OCR" }),
  ];
  const values: Record<string, string> = { make: "Mazda", model: "", modelYear: "2019", color: "أبيض", bookablePassengerCapacity: "", licensedPassengerCapacity: "5", plateNumber: "SYN-0001", vin: "", licenseExpiry: "31/05/2027" };
  const statusOf = (f: F) => fieldStatus(f, values[f.key], false);

  it("lists missing required items in card order — type first, declaration last — and counts done / total", () => {
    const r = reviewReadiness({ fields, values, statusOf, vehicleType: "", declaration: false });
    expect(r.missing).toEqual(["vehicleType", "model", "bookablePassengerCapacity", "vin", "declaration"]);
    expect(r.total).toBe(1 + fields.filter((f) => f.required).length + 1);
    expect(r.completed).toBe(r.total - r.missing.length);
  });

  it("'needs review' uses the SAME rule as the field chip (flagged and not yet the provider's own)", () => {
    const r = reviewReadiness({ fields, values, statusOf, vehicleType: "SEDAN", declaration: true });
    expect(r.needsReview).toEqual(["make", "licensedPassengerCapacity"]);
    const typedValues: Record<string, string> = { ...values, make: "Toyota" };
    const typed = reviewReadiness({ fields, values: typedValues, statusOf: (f) => fieldStatus(f, typedValues[f.key], false), vehicleType: "SEDAN", declaration: true });
    expect(typed.needsReview).toEqual(["licensedPassengerCapacity"]); // typed → "entered by you" → no longer flagged
  });

  it("blank values never count as done; whitespace is blank", () => {
    const r = reviewReadiness({ fields, values: { ...values, model: "   " }, statusOf, vehicleType: "SEDAN", declaration: true });
    expect(r.missing).toContain("model");
  });

  it("the card never claims 'complete' while the shared validator still refuses", () => {
    expect(FORM).toMatch(/const allComplete = readiness\.missing\.length === 0 && localCheck\.ok;/);
    expect(FORM).toMatch(/\{allComplete \? t\("vehicleCardReadyAll"\) : invalidValues \? t\("vehicleCardReadyInvalid"\) : td\("vehicleCardReadyCompleted"/);
    // a value the validator REJECTS (not merely empty) is listed to correct — never hidden behind "complete"
    expect(FORM).toMatch(/localCheck\.errors\.filter\(\(e\) => e\.code !== "REQUIRED" && e\.field !== "declaration"\)/);
    expect(FORM).toMatch(/e\.field === "capacity" \? CAPACITY_SHOWN_TO_CUSTOMERS : e\.field/);
    expect(FORM).toMatch(/\{invalidItems\.length > 0 && \(/);
    // each missing item jumps to its field (opening the private card when needed) — no server call
    const goTo = FORM.slice(FORM.indexOf("const goTo"), FORM.indexOf("const missingLabel"));
    expect(goTo).toMatch(/setPrivateOpen\(true\)/);
    expect(goTo).not.toMatch(/Action\(|fetch\(|router\./);
  });
});

describe("Card 1 — document result", () => {
  it("one short line: fields found and how many need review — only when a reading happened; no privacy notice repeated", () => {
    // only fields a document can carry are counted (bookable capacity is always provider-entered)
    expect(PAGE).toMatch(/const readableFields = review\.fields\.filter\(\(f\) => CONFIRMATION_FIELDS\[f\.key as ConfirmationFieldKey\]\.extractionKey !== null\);/);
    expect(PAGE).toMatch(/const foundCount = readableFields\.filter\(\(f\) => f\.extractedValue !== null\)\.length;/);
    expect(CONFIRMATION_FIELDS.bookablePassengerCapacity.extractionKey).toBeNull();
    expect(PAGE).toMatch(/\{!isManual && \(\s*<p className="text-sm text-foreground\/80" data-reading-summary="">/);
    const card = PAGE.slice(PAGE.indexOf('aria-label={t("vehicleRegDocumentLabel")}'), PAGE.indexOf("{readingFailed && ("));
    expect(card).not.toMatch(/vehicleRegConsent|automatic-reading|PrivacyPolicy/);
  });
});

describe("typography hierarchy (scoped to the journey) and wording", () => {
  // the phone token block of the shared type scale (globals.css "Typography scale")
  const token = (name: string) => {
    const start = CSS.search(/:root \{\s*--text-xs/);
    const block = CSS.slice(start, CSS.indexOf("}", start));
    const m = block.match(new RegExp(`--${name}:\\s*([0-9.]+)rem`));
    return m ? Math.round(parseFloat(m[1]!) * 16) : NaN;
  };
  it("phones: title 30 px, card heading 22 px, label / value / button 17 px, supporting text 16 px", () => {
    expect(UI).toMatch(/export const JOURNEY_TITLE = "text-3xl /);
    expect(UI).toMatch(/export const JOURNEY_CARD_TITLE = "text-xl /);
    expect(token("text-3xl")).toBe(30);
    expect(token("text-xl")).toBe(22);
    expect(token("text-base")).toBe(17);
    expect(token("text-label")).toBe(17);
    expect(token("text-sm")).toBe(16);
  });

  it("desktop keeps labels, values and buttons at 17 px (not the calmer 15–16 px desktop tokens) and buttons 48 px", () => {
    expect(UI).toMatch(/export const JOURNEY_LABEL = "form-label lg:text-\[1\.0625rem\]";/);
    expect(UI).toMatch(/export const JOURNEY_INPUT =\s*"min-h-12 [^"]*text-base lg:text-\[1\.0625rem\]/);
    for (const name of ["JOURNEY_PRIMARY", "JOURNEY_SECONDARY", "JOURNEY_TERTIARY"]) expect(UI, name).toMatch(new RegExp(`export const ${name} = \`inline-flex min-h-12 [^\`]*lg:text-\\[1\\.0625rem\\]`));
    expect(FORM).not.toMatch(/className="form-label"/); // every review label uses the journey label
  });

  it("Arabic and English card copy is exactly as approved", () => {
    expect(messages.ar!.vehicleCardCustomerTitle).toBe("المعلومات التي ستظهر للعميل");
    expect(messages.en!.vehicleCardCustomerTitle).toBe("Information shown to customers");
    expect(messages.ar!.vehicleCardPrivateNote).toBe("هذه البيانات خاصة بك وبإدارة برق ولا تظهر للعملاء.");
    expect(messages.en!.vehicleCardPrivateNote).toBe("These details are private to you and BARQ administration and are never shown to customers.");
  });

  it.each(LOCALES)("%s has every card key, with the placeholders intact", (l) => {
    const m = messages[l]!;
    for (const k of Object.keys(messages.en!).filter((x) => x.startsWith("vehicleCard"))) expect(m[k]?.trim().length ?? 0, `${l}.${k}`).toBeGreaterThan(0);
    for (const [k, ph] of [["vehicleCardReadyCompleted", ["{done}", "{total}"]], ["vehicleCardReadyReview", ["{count}"]], ["vehicleCardDocFound", ["{found}", "{total}"]], ["vehicleCardDocReview", ["{count}"]]] as const) for (const p of ph) expect(m[k], `${l}.${k}`).toContain(p);
    expect(m.vehicleCardCustomerTitle).not.toContain("بارق");
  });
});
