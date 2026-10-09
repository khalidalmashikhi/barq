// Phase 3C — Vehicle Registration Extraction, Slice 2. Arabic + English label registry
// for the ALLOWLISTED operational fields, and a PII denylist whose lines are DISCARDED
// (never captured). Pure, deterministic, data-only + matching helpers. No PII values here.
//
// OMAN TERMINOLOGY (2026-10-09 correction). The Omani registration card (mulkiya) prints:
//   • "نوع المركبة" — the COMPOUND vehicle description (brand + body style + model in one line),
//     NOT the manufacturer alone → captured as `vehicleDescription`, never as the make;
//   • "الموديل" — usually the MODEL YEAR, not the commercial model → captured under `model` by
//     label and then ROUTED by value in the shared builder (a 4-digit year → `manufactureYear`;
//     a name stays `model`);
//   • "عدد الركاب" — the licensed PASSENGER count; a SEAT count ("عدد المقاعد") is a different
//     field (`registeredSeats`) and is captured only when such a label is actually printed.
// The same registry drives the OCR tool's field guidance, so both tiers share one meaning.

import type { RegistrationFieldKey } from "./types";
import { cleanForMatching, foldForMatching, foldWithMap } from "./normalize";

// Each field's accepted labels (Arabic variants + English). Matching is case-insensitive
// (English) and Arabic is caseless; punctuation/bidi/whitespace are normalized first.
// Note the deliberate overlap risk between "رقم الهيكل" (chassis) and "رقم المحرك"
// (engine) — longest-match ordering in the index resolves it.
export const REGISTRATION_LABELS: Record<RegistrationFieldKey, readonly string[]> = {
  plateNumber: ["رقم اللوحة", "رقم اللوحه", "plate number", "plate no", "plate"],
  plateType: ["نوع اللوحة", "فئة اللوحة", "plate type", "plate category"],
  // Explicit manufacturer labels ONLY — the compound "نوع المركبة" is NOT a make label.
  makeDescription: ["الشركة الصانعة", "الماركة", "ماركة", "الصنع", "manufacturer", "vehicle make", "make", "brand"],
  // "الموديل" / "model" are accepted here but a YEAR under them is routed to manufactureYear.
  model: ["اسم الطراز", "الطراز", "الموديل", "model name", "commercial model", "model"],
  vehicleDescription: ["نوع المركبة", "وصف المركبة", "vehicle description", "vehicle type", "description"],
  color: ["اللون", "colour", "color"],
  usageClassification: ["نوع الاستخدام", "الاستعمال", "الاستخدام", "usage type", "usage"],
  manufactureYear: ["سنة الصنع", "سنة الموديل", "سنة التصنيع", "year of manufacture", "model year", "manufacture year", "year"],
  engineCapacity: ["سعة المحرك", "engine capacity", "engine cc"],
  emptyWeight: ["الوزن الفارغ", "الوزن فارغ", "وزن المركبة فارغة", "empty weight", "unladen weight"],
  maximumLoad: ["الحمولة القصوى", "أقصى حمولة", "الحمولة", "maximum load", "max load"],
  axleCount: ["عدد المحاور", "number of axles", "axles"],
  licensedPassengerCapacity: ["عدد الركاب", "number of passengers", "passengers"],
  registeredSeats: ["عدد المقاعد", "المقاعد", "number of seats", "total seats", "seating capacity", "seats"],
  vin: ["رقم الهيكل", "رقم الشاصي", "رقم الشاسيه", "chassis number", "chassis no", "vin"],
  engineNumber: ["رقم المحرك", "engine number", "engine no"],
  licenseValidFrom: ["تاريخ الإصدار", "ساري من", "valid from", "issue date"],
  licenseExpiry: ["تاريخ الانتهاء", "تاريخ انتهاء الرخصة", "ينتهي في", "صالحة حتى", "expiry date", "valid until", "expiry"],
  firstRegistrationDate: ["تاريخ أول تسجيل", "أول تسجيل", "first registration", "first registered"],
};

/** What each field MEANS — one sentence per key, shared with the OCR tool schema so an engine is
 *  told the same semantics the deterministic parser applies. Never values, never PII. */
export const REGISTRATION_FIELD_GUIDANCE: Record<RegistrationFieldKey, string> = {
  plateNumber: "The plate / registration number exactly as printed (labels: رقم اللوحة / plate number).",
  plateType: "The plate category (e.g. private, commercial) printed under نوع اللوحة / plate type.",
  makeDescription: "The manufacturer or brand ONLY (e.g. a brand name), and only when it is printed as its own value under a make / brand label (الماركة / الصنع / manufacturer / make). Do NOT put the full vehicle description here. Never a year.",
  model: "The commercial model NAME only, when printed as a name (الطراز / model name). NEVER a year: on Omani cards the label الموديل usually holds the model YEAR — report a year under manufactureYear instead.",
  vehicleDescription: "The full vehicle description string exactly as printed under نوع المركبة / vehicle type / description — usually brand + body style + model in one line. Copy the whole line; do not split it into parts.",
  color: "The colour printed under اللون / colour.",
  usageClassification: "The usage / classification value printed under نوع الاستخدام / الاستخدام / usage — only when such a label exists. Never derived from the plate type.",
  manufactureYear: "The 4-digit model year / year of manufacture (سنة الصنع / year of manufacture, or the year printed under الموديل / model).",
  engineCapacity: "Engine capacity with its unit as printed (سعة المحرك / engine capacity).",
  emptyWeight: "Empty / unladen weight with its unit as printed (الوزن الفارغ / empty weight).",
  maximumLoad: "Maximum load with its unit as printed (الحمولة القصوى / maximum load).",
  axleCount: "Number of axles (عدد المحاور / axles).",
  licensedPassengerCapacity: "The passenger count printed under عدد الركاب / number of passengers — passengers only, never seats.",
  registeredSeats: "The total seat count ONLY when a separate seats label is printed (عدد المقاعد / seats / seating capacity). Never compute it from the passenger count; leave it out if no seats label exists.",
  vin: "The chassis / VIN number exactly as printed (رقم الهيكل / chassis number / VIN).",
  engineNumber: "The engine number exactly as printed (رقم المحرك / engine number).",
  licenseValidFrom: "The licence issue / valid-from date as printed (تاريخ الإصدار / valid from).",
  licenseExpiry: "The licence expiry date as printed (تاريخ الانتهاء / expiry date).",
  firstRegistrationDate: "The first registration date as printed (تاريخ أول تسجيل / first registration).",
};

// PII / non-operational labels. Any line whose text contains one of these is DISCARDED
// wholesale — its value is never captured, normalized, persisted, or logged.
export const REGISTRATION_PII_LABELS: readonly string[] = [
  "المالك", "اسم المالك", "owner name", "owner",
  "الجنسية", "nationality",
  "العنوان", "address",
  "الرقم المدني", "البطاقة الشخصية", "civil number", "civil no", "id number",
  "شركة التأمين", "insurance company", "insurer",
  "رقم الوثيقة", "رقم البوليصة", "policy number", "policy no",
  "نوع التأمين", "insurance type",
  "الرهن", "mortgage", "lien",
  "التوقيع", "signature",
  "الباركود", "الرقم المرجعي", "barcode", "reference number",
  "الموظف المسؤول", "issuing officer", "officer",
];

// Flat index sorted by descending label length so the most specific label wins
// (e.g. "رقم الهيكل"/"رقم المحرك" never collide, "الحمولة القصوى" beats "الحمولة", and
// "سنة الموديل" (year) beats "الموديل" (model)).
// Labels are matched on the FOLDED line (normalize.ts: canonical letters, no diacritics / tatweel,
// unified alef, punctuation as spaces, lower case) so a PDF text layer made of presentation-form
// glyphs or kashida-stretched labels still matches; the VALUE is cut from the original line.
type LabelEntry = { field: RegistrationFieldKey; label: string };
const LABEL_INDEX: LabelEntry[] = (Object.keys(REGISTRATION_LABELS) as RegistrationFieldKey[])
  .flatMap((field) => REGISTRATION_LABELS[field].map((label) => ({ field, label: foldForMatching(label) })))
  .filter((e) => e.label.length > 0)
  .sort((a, b) => b.label.length - a.label.length);

const PII_INDEX: string[] = [...REGISTRATION_PII_LABELS].map((l) => foldForMatching(l)).filter(Boolean).sort((a, b) => b.length - a.length);

const SEP_PREFIX = /^[\s:：\-–—.،\/|]+/;

export type LineMatch =
  | { kind: "pii" }
  | { kind: "field"; field: RegistrationFieldKey; rawValue: string }
  | { kind: "none" };

/** Classify a single physical line of extracted text. PII lines are reported so the parser
 *  can discard them (and only note that PII WAS present, never its value). A field match
 *  returns the captured value substring (bidi/whitespace-cleaned, not yet type-normalized). */
export function matchLine(line: string): LineMatch {
  const cleaned = cleanForMatching(line);
  if (cleaned.length === 0) return { kind: "none" };
  const { folded, map } = foldWithMap(cleaned);
  const lower = folded;
  // Folded index → index in the cleaned (original-spelling) line.
  const origAt = (idx: number): number => (idx >= map.length ? cleaned.length : map[idx]!);

  // PII first — a line naming an owner/insurer/etc. is dropped even if it also happens to
  // contain a digit an operational label might otherwise grab.
  for (const pii of PII_INDEX) {
    if (pii.length > 0 && lower.includes(pii)) return { kind: "pii" };
  }

  for (const { field, label } of LABEL_INDEX) {
    const at = lower.indexOf(label);
    if (at < 0) continue;
    // A label must stand on its own word (so "model" never matches inside "models", "year" inside
    // "yearly", nor an Arabic label inside a longer word).
    const prevCh = at === 0 ? " " : lower[at - 1]!;
    const nextCh = lower[at + label.length] ?? " ";
    if (/[\p{L}\p{N}]/u.test(prevCh) || /[\p{L}]/u.test(nextCh)) continue;
    const afterStart = at + label.length;
    // Prefer the text AFTER the label; fall back to text BEFORE it (RTL layouts sometimes
    // place the value first). Capture from the ORIGINAL cleaned line to preserve glyphs/case.
    let after = cleaned.slice(origAt(afterStart)).replace(SEP_PREFIX, "").trim();
    if (after.length === 0) {
      after = cleaned.slice(0, origAt(at)).replace(SEP_PREFIX, "").replace(/[\s:：\-–—.،]+$/, "").trim();
    }
    if (after.length === 0) return { kind: "none" };
    // Bilingual layouts print the same label twice ("الماركة / Make: …"): a second label of the
    // SAME field at the start of the captured text is part of the label, not of the value.
    for (let guard = 0; guard < 3; guard++) {
      const fa = foldWithMap(after);
      const dup = REGISTRATION_LABELS[field]
        .map((l) => foldForMatching(l))
        .filter((ll) => ll.length > 0 && fa.folded.startsWith(ll) && !/^[\p{L}]/u.test(fa.folded.slice(ll.length)))
        .sort((a, b) => b.length - a.length)[0];
      if (!dup) break;
      const cut = dup.length >= fa.map.length ? after.length : fa.map[dup.length]!;
      after = after.slice(cut).replace(SEP_PREFIX, "").trim();
    }
    if (after.length === 0) return { kind: "none" };
    return { kind: "field", field, rawValue: after };
  }
  return { kind: "none" };
}
