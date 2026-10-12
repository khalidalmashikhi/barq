import { describe, it, expect, vi, afterEach } from "vitest";
import {
  applySuggestion,
  canApplySuggestion,
  decodeAppliedSuggestions,
  encodeAppliedSuggestions,
  fieldStatus,
  initialFieldValue,
  isBlank,
  isSuggestionOnly,
  hasUnsavedChanges,
  statusLabelKey,
  describesDocument,
  restorableAppliedSuggestions,
  reviewFieldsSignature,
  suggestionText,
  syncUntouchedValues,
  type ReviewFieldStateInput,
} from "./review-field-state";
import { parseConfirmation } from "./confirmation-input";

// Review UX correction (2026-10-11) — behaviour of the provider's review form, proven on the PURE
// rules the form calls (Vitest here runs without a DOM). Synthetic values only.

const fetchGuard = vi.fn(() => {
  throw new Error("OUTBOUND REQUEST ATTEMPTED");
});
vi.stubGlobal("fetch", fetchGuard);
afterEach(() => expect(fetchGuard).not.toHaveBeenCalled());

type F = ReviewFieldStateInput;
const f = (key: string, over: Partial<F> = {}): F => ({ key, kind: "text", extractedValue: null, confirmedValue: null, source: "UNRESOLVED", ...over });

/** The observed staging state: make/model are DERIVED suggestions, year and colour direct values. */
const STAGING: F[] = [
  f("make", { extractedValue: "Mazda", source: "NATIVE_PDF_TEXT", heuristic: true }),
  f("model", { extractedValue: "6", source: "NATIVE_PDF_TEXT", heuristic: true }),
  f("modelYear", { kind: "int", extractedValue: 2019, source: "NATIVE_PDF_TEXT" }),
  f("color", { extractedValue: "أبيض", source: "NATIVE_PDF_TEXT" }),
  f("bookablePassengerCapacity", { kind: "int" }),
  f("licensedPassengerCapacity", { kind: "int", extractedValue: 5, source: "NATIVE_PDF_TEXT" }),
  f("licenseExpiry", { kind: "date", extractedValue: "2027-05-31", source: "NATIVE_PDF_TEXT" }),
];
const byKey = (k: string, list = STAGING) => list.find((x) => x.key === k)!;
const start = (list = STAGING) => Object.fromEntries(list.map((x) => [x.key, initialFieldValue(x)]));

describe("root cause (synthetic reproduction of the staging screen)", () => {
  it("OLD rule: values created once on mount, then the review re-rendered with new suggestions → an EMPTY input counted as 'edited' and was labelled 'entered by you'", () => {
    const oldInitial = (x: F) => String(x.confirmedValue ?? x.extractedValue ?? "");
    const beforeReread = { make: "", model: "" }; // mounted while make/model were unresolved
    const afterReread = byKey("make"); // the refresh brought "Mazda"
    const edited = (beforeReread.make ?? "") !== oldInitial(afterReread);
    expect(edited).toBe(true); // → source "PROVIDER" ("أدخلته أنت") + a passive "اقتراح النظام: Mazda" line, no action
  });

  it("NEW rule: the same blank input is a SUGGESTION awaiting confirmation, never 'entered by you', and offers the action", () => {
    expect(fieldStatus(byKey("make"), "", false)).toBe("SUGGESTED");
    expect(canApplySuggestion(byKey("make"), "")).toBe(true);
    // untouched fields follow the server after an in-place refresh
    const synced = syncUntouchedValues({ make: "", model: "", color: "" }, {}, STAGING);
    expect(synced).toMatchObject({ make: "", model: "", color: "أبيض", modelYear: "2019" });
  });
});

describe("starting values", () => {
  it("a DERIVED make / model is not pre-filled; direct document values still are (dates as DD/MM/YYYY)", () => {
    expect(isSuggestionOnly(byKey("make"))).toBe(true);
    expect(start()).toMatchObject({ make: "", model: "", modelYear: "2019", color: "أبيض", bookablePassengerCapacity: "", licensedPassengerCapacity: "5", licenseExpiry: "31/05/2027" });
  });

  it("an automatically COMPLETED make / model is a suggestion too; a direct (labelled) make is pre-filled as before", () => {
    expect(initialFieldValue(f("make", { extractedValue: "Mazda", completedAutomatically: true }))).toBe("");
    expect(initialFieldValue(f("make", { extractedValue: "Mazda", source: "NATIVE_PDF_TEXT" }))).toBe("Mazda");
  });

  it("the provider's own saved draft value always wins", () => {
    expect(initialFieldValue(f("make", { extractedValue: "Mazda", heuristic: true, confirmedValue: "Testmake" }))).toBe("Testmake");
  });
});

describe("1–10. applying a suggestion", () => {
  it("1/2. empty make / model with a suggestion offer 'Use <value>' (the exact normalized suggestion)", () => {
    expect(canApplySuggestion(byKey("make"), "")).toBe(true);
    expect(suggestionText(byKey("make"))).toBe("Mazda");
    expect(canApplySuggestion(byKey("model"), "")).toBe(true);
    expect(suggestionText(byKey("model"))).toBe("6");
  });

  it("3/6/9/10. applying make fills ONLY make — model, year, colour and capacities are untouched", () => {
    const before = start();
    const after = applySuggestion(before, byKey("make"));
    expect(after.make).toBe("Mazda");
    for (const k of Object.keys(before)) if (k !== "make") expect(after[k], k).toBe(before[k]);
  });

  it("4/7/9/10. applying model fills ONLY model", () => {
    const before = start();
    const after = applySuggestion(before, byKey("model"));
    expect(after.model).toBe("6");
    for (const k of Object.keys(before)) if (k !== "model") expect(after[k], k).toBe(before[k]);
  });

  it("5. applying is a pure local update — no network request (the fetch guard fails the test otherwise)", () => {
    applySuggestion(start(), byKey("make"));
    applySuggestion(start(), byKey("model"));
  });

  it("8. neither action selects a vehicle type (there is no type in the values it returns)", () => {
    const after = applySuggestion(applySuggestion(start(), byKey("make")), byKey("model"));
    expect(Object.keys(after)).not.toContain("vehicleType");
  });

  it("only make and model have the action; a field with no suggestion has none", () => {
    expect(canApplySuggestion(byKey("color"), "")).toBe(false);
    expect(canApplySuggestion(byKey("bookablePassengerCapacity"), "")).toBe(false);
    expect(canApplySuggestion(f("make"), "")).toBe(false);
  });
});

describe("11–14. typed input is never overwritten", () => {
  it("11/12. a typed make / model hides the action and applying changes nothing", () => {
    for (const k of ["make", "model"]) {
      const values = { ...start(), [k]: "Typedvalue" };
      expect(canApplySuggestion(byKey(k), "Typedvalue")).toBe(false);
      expect(applySuggestion(values, byKey(k))).toBe(values);
    }
  });

  it("13. whitespace-only is treated as empty", () => {
    expect(isBlank("   ")).toBe(true);
    expect(canApplySuggestion(byKey("make"), "  \t ")).toBe(true);
    expect(fieldStatus(byKey("make"), "   ", false)).toBe("SUGGESTED");
    expect(fieldStatus(byKey("bookablePassengerCapacity"), "  ", false)).toBe("NOT_ENTERED");
  });

  it("14. clearing a field brings the action back", () => {
    expect(canApplySuggestion(byKey("make"), "Typed")).toBe(false);
    expect(canApplySuggestion(byKey("make"), "")).toBe(true);
  });
});

describe("15–18. truthful status", () => {
  it("15. a blank field is NEVER 'entered by you' (empty, whitespace, undefined)", () => {
    for (const x of STAGING) for (const v of ["", "   ", undefined]) expect(fieldStatus(x, v, false), x.key).not.toBe("PROVIDER");
  });

  it("empty with no suggestion → NOT_ENTERED; empty with a suggestion → SUGGESTED", () => {
    expect(fieldStatus(byKey("bookablePassengerCapacity"), "", false)).toBe("NOT_ENTERED");
    expect(fieldStatus(byKey("model"), "", false)).toBe("SUGGESTED");
  });

  it("16. a typed non-empty value → PROVIDER ('Entered by you')", () => {
    expect(fieldStatus(byKey("make"), "Othermake", false)).toBe("PROVIDER");
    expect(fieldStatus(byKey("bookablePassengerCapacity"), "4", false)).toBe("PROVIDER");
    expect(fieldStatus(byKey("color"), "أحمر", false)).toBe("PROVIDER");
  });

  it("17. an applied suggestion → APPLIED ('Document suggestion selected'); editing it afterwards → PROVIDER", () => {
    expect(fieldStatus(byKey("make"), "Mazda", true)).toBe("APPLIED");
    expect(fieldStatus(byKey("make"), "Mazda 3", true)).toBe("PROVIDER");
  });

  it("a SAVED value equal to the document's current suggestion reads with the document wording (SOURCE) — 'selected' is reserved for an apply in THIS form", () => {
    const saved = f("make", { extractedValue: "Mazda", heuristic: true, confirmedValue: "Mazda", source: "NATIVE_PDF_TEXT" });
    expect(fieldStatus(saved, initialFieldValue(saved), false)).toBe("SOURCE");
    expect(fieldStatus(saved, "Mazda", true)).toBe("APPLIED"); // applied again in this form
  });

  it("18. a direct document value, untouched → SOURCE (the form keeps the existing document / OCR wording)", () => {
    expect(fieldStatus(byKey("color"), "أبيض", false)).toBe("SOURCE");
    expect(fieldStatus(byKey("modelYear"), "2019", false)).toBe("SOURCE");
    expect(fieldStatus(byKey("licenseExpiry"), "31/05/2027", false)).toBe("SOURCE");
  });
});

describe("19–21. submit path and server validation are unchanged", () => {
  it("19. applied values are ordinary form values — the existing validator accepts them in the submit payload", () => {
    const values = applySuggestion(applySuggestion(start(), byKey("make")), byKey("model"));
    const r = parseConfirmation({ ...values, modelYear: "2019", color: "أبيض", bookablePassengerCapacity: "4", licensedPassengerCapacity: "5", plateNumber: "T 99001", vin: "TESTV1N0000000001", licenseExpiry: "2027-05-31", declarationAccepted: true }, "SUBMIT");
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.ok).toBe(true);
  });

  it("20. without applying (or typing) make / model, the same validator still rejects the submission", () => {
    const r = parseConfirmation({ ...start(), bookablePassengerCapacity: "4", plateNumber: "T 99001", vin: "TESTV1N0000000001", licenseExpiry: "2027-05-31", declarationAccepted: true }, "SUBMIT");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.field)).toEqual(expect.arrayContaining(["make", "model"]));
  });
});

describe("22/23. persistence", () => {
  it("22. ordinary re-renders / a refresh with the same data keep applied and typed values (touched fields are never re-synced)", () => {
    const applied = applySuggestion(start(), byKey("make"));
    const typed = { ...applied, model: "Typedmodel" };
    const touched = { make: true, model: true };
    expect(syncUntouchedValues(typed, touched, STAGING)).toMatchObject({ make: "Mazda", model: "Typedmodel" });
  });

  it("23. the language switch: applied suggestions round-trip through the session encoding and are restored only while they still equal the server's suggestion", () => {
    const encoded = encodeAppliedSuggestions({ make: "Mazda", model: "6", vehicleType: "SEDAN", plateNumber: "T 99001" }, "reading-1");
    expect(encoded).not.toBeNull();
    const decoded = decodeAppliedSuggestions(encoded, "reading-1");
    expect(decoded).toEqual({ make: "Mazda", model: "6" }); // only make / model are ever remembered
    expect(restorableAppliedSuggestions(decoded, STAGING)).toEqual({ make: "Mazda", model: "6" });
    // a stale memory (the server now suggests something else) is dropped, never injected
    expect(restorableAppliedSuggestions({ make: "Toyota" }, STAGING)).toEqual({});
    // a field that already starts with the provider's own saved value is not overridden
    const withDraft = STAGING.map((x) => (x.key === "make" ? { ...x, confirmedValue: "Testmake" } : x));
    expect(restorableAppliedSuggestions({ make: "Mazda" }, withDraft)).toEqual({});
    expect(decodeAppliedSuggestions("{not json", "reading-1")).toEqual({});
    expect(encodeAppliedSuggestions({}, "reading-1")).toBeNull();
  });

  it("13. a remembered suggestion is NEVER restored after its source reading changed (re-read, replaced document) — even if the text is the same", () => {
    const encoded = encodeAppliedSuggestions({ make: "Mazda" }, "reading-1");
    expect(decodeAppliedSuggestions(encoded, "reading-2")).toEqual({});
    expect(decodeAppliedSuggestions(encoded, null)).toEqual({});
    expect(encodeAppliedSuggestions({ make: "Mazda" }, null)).toBeNull(); // no reading → nothing remembered
    // the unbound format written before 2026-10-12 is ignored, never injected
    expect(decodeAppliedSuggestions(JSON.stringify({ make: "Mazda" }), "reading-1")).toEqual({});
  });

  it("the re-sync trigger changes when the server data changes and not otherwise", () => {
    const a = reviewFieldsSignature(STAGING);
    expect(reviewFieldsSignature(STAGING.map((x) => ({ ...x })))).toBe(a);
    expect(reviewFieldsSignature(STAGING.map((x) => (x.key === "make" ? { ...x, extractedValue: "Toyota" } : x)))).not.toBe(a);
  });
});

// ── 2026-10-12 — one contract for the onboarding review AND the vehicle-detail confirmation form ─────
describe("detail / onboarding parity — saved values, statuses and unsaved changes", () => {
  /** The detail page: the provider's SAVED claim (confirmation) for some fields. */
  const DETAIL: F[] = [
    f("make", { extractedValue: "Mazda", heuristic: true, confirmedValue: "Testmake", source: "PROVIDER" }),
    f("model", { extractedValue: "6", heuristic: true, source: "NATIVE_PDF_TEXT" }),
    f("modelYear", { kind: "int", extractedValue: 2019, confirmedValue: 2019, source: "NATIVE_PDF_TEXT" }),
    f("color", { extractedValue: "أبيض", confirmedValue: "أحمر", source: "PROVIDER" }),
    f("bookablePassengerCapacity", { kind: "int", confirmedValue: 4, source: "PROVIDER" }),
    f("licensedPassengerCapacity", { kind: "int", extractedValue: 5, source: "NATIVE_PDF_TEXT" }),
    f("registeredSeats", { kind: "int" }),
    f("licenseExpiry", { kind: "date", extractedValue: "2027-05-31", confirmedValue: "2027-05-31", source: "NATIVE_PDF_TEXT" }),
  ];
  const d = (k: string) => DETAIL.find((x) => x.key === k)!;
  const detailStart = () => Object.fromEntries(DETAIL.map((x) => [x.key, initialFieldValue(x)]));

  it("1. saved make / values stay FILLED and read 'Current value' — never 'entered by you', never cleared for lack of extraction", () => {
    expect(detailStart()).toMatchObject({ make: "Testmake", color: "أحمر", bookablePassengerCapacity: "4" });
    expect(fieldStatus(d("make"), "Testmake", false)).toBe("CURRENT");
    expect(fieldStatus(d("color"), "أحمر", false)).toBe("CURRENT");
    expect(fieldStatus(d("bookablePassengerCapacity"), "4", false)).toBe("CURRENT");
    expect(statusLabelKey("CURRENT", "PROVIDER")).toBe("vehicleRegStatusCurrent");
    // a saved value with no extraction at all stays filled too
    expect(initialFieldValue(f("make", { confirmedValue: "Testmake", source: "PROVIDER" }))).toBe("Testmake");
  });

  it("a saved value that IS the document's current value keeps the document wording (reliable — compared live)", () => {
    expect(fieldStatus(d("modelYear"), "2019", false)).toBe("SOURCE");
    expect(statusLabelKey("SOURCE", "NATIVE_PDF_TEXT")).toBe("vehicleRegSourceDocument");
    expect(statusLabelKey("SOURCE", "OCR")).toBe("vehicleRegSourceOcr");
    expect(fieldStatus(d("licenseExpiry"), "31/05/2027", false)).toBe("SOURCE");
  });

  it("2/3/4. empty with no suggestion → NOT_ENTERED; empty with a suggestion → SUGGESTED; blank is never PROVIDER", () => {
    expect(fieldStatus(d("registeredSeats"), "", false)).toBe("NOT_ENTERED");
    expect(fieldStatus(d("model"), "", false)).toBe("SUGGESTED");
    for (const x of DETAIL) for (const v of ["", "  ", undefined]) expect(fieldStatus(x, v, false)).not.toBe("PROVIDER");
  });

  it("5/6/8. applying model fills ONLY model; a saved make is never overwritten (no action offered)", () => {
    const after = applySuggestion(detailStart(), d("model"));
    expect(after.model).toBe("6");
    for (const k of Object.keys(after)) if (k !== "model") expect(after[k], k).toBe(detailStart()[k]);
    expect(canApplySuggestion(d("make"), "Testmake")).toBe(false);
    expect(applySuggestion(detailStart(), d("make"))).toEqual(detailStart());
  });

  it("9/10. clearing an unsaved applied value restores the suggestion; typing produces 'entered by you'", () => {
    expect(fieldStatus(d("model"), "6", true)).toBe("APPLIED");
    expect(fieldStatus(d("model"), "", true)).toBe("SUGGESTED");
    expect(canApplySuggestion(d("model"), "")).toBe(true);
    expect(fieldStatus(d("make"), "Othermake", false)).toBe("PROVIDER");
  });

  it("11/12. a server refresh updates only UNTOUCHED fields and never overwrites provider edits", () => {
    const edited = { ...detailStart(), color: "Typedcolour" };
    const refreshed = DETAIL.map((x) => (x.key === "color" ? { ...x, confirmedValue: "Servercolour" } : x.key === "licensedPassengerCapacity" ? { ...x, extractedValue: 7 } : x));
    const synced = syncUntouchedValues(edited, { color: true }, refreshed);
    expect(synced.color).toBe("Typedcolour");
    expect(synced.licensedPassengerCapacity).toBe("7");
  });

  it("15–17. unsaved-change detection drives Discard; a discarded / saved form is back to the server values", () => {
    expect(hasUnsavedChanges(detailStart(), DETAIL)).toBe(false);
    expect(hasUnsavedChanges({ ...detailStart(), model: "6" }, DETAIL)).toBe(true);
    expect(hasUnsavedChanges({ ...detailStart(), color: "Typed" }, DETAIL)).toBe(true);
  });

  it("19. capacities are never filled from one another: a blank bookable / seats field gets no suggestion and no action", () => {
    const blank = { ...detailStart(), bookablePassengerCapacity: "" };
    expect(canApplySuggestion(d("bookablePassengerCapacity"), "")).toBe(false);
    expect(canApplySuggestion(d("registeredSeats"), "")).toBe(false);
    expect(applySuggestion(blank, d("bookablePassengerCapacity"))).toBe(blank);
  });

  it("20. dates start as DD/MM/YYYY from the canonical ISO (submission converts back — date-display tests)", () => {
    expect(initialFieldValue(d("licenseExpiry"))).toBe("31/05/2027");
  });

  it("document chips apply only while the status describes the document", () => {
    expect(["SOURCE", "SUGGESTED", "APPLIED"].every((x) => describesDocument(x as never))).toBe(true);
    expect(["CURRENT", "PROVIDER", "NOT_ENTERED"].some((x) => describesDocument(x as never))).toBe(false);
  });
});
