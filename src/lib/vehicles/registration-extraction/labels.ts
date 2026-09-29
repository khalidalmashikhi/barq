// Phase 3C — Vehicle Registration Extraction, Slice 2. Arabic + English label registry
// for the ALLOWLISTED operational fields, and a PII denylist whose lines are DISCARDED
// (never captured). Pure, deterministic, data-only + matching helpers. No PII values here.

import type { RegistrationFieldKey } from "./types";
import { cleanForMatching } from "./normalize";

// Each field's accepted labels (Arabic variants + English). Matching is case-insensitive
// (English) and Arabic is caseless; punctuation/bidi/whitespace are normalized first.
// Note the deliberate overlap risk between "رقم الهيكل" (chassis) and "رقم المحرك"
// (engine) — longest-match ordering in the index resolves it.
export const REGISTRATION_LABELS: Record<RegistrationFieldKey, readonly string[]> = {
  plateNumber: ["رقم اللوحة", "رقم اللوحه", "plate number", "plate no", "plate"],
  plateType: ["نوع اللوحة", "فئة اللوحة", "plate type", "plate category"],
  makeDescription: ["نوع المركبة", "الماركة", "الصنع", "vehicle make", "make", "vehicle type"],
  model: ["الموديل", "الطراز", "model"],
  color: ["اللون", "colour", "color"],
  usageClassification: ["نوع الاستخدام", "الاستعمال", "الاستخدام", "usage"],
  manufactureYear: ["سنة الصنع", "سنة الموديل", "year of manufacture", "model year", "manufacture year"],
  engineCapacity: ["سعة المحرك", "engine capacity", "engine cc"],
  emptyWeight: ["الوزن الفارغ", "الوزن فارغ", "وزن المركبة فارغة", "empty weight", "unladen weight"],
  maximumLoad: ["الحمولة القصوى", "أقصى حمولة", "الحمولة", "maximum load", "max load"],
  axleCount: ["عدد المحاور", "number of axles", "axles"],
  licensedPassengerCapacity: ["عدد الركاب", "number of passengers", "seating capacity", "passengers"],
  vin: ["رقم الهيكل", "رقم الشاصي", "رقم الشاسيه", "chassis number", "chassis no", "vin"],
  engineNumber: ["رقم المحرك", "engine number", "engine no"],
  licenseValidFrom: ["تاريخ الإصدار", "ساري من", "valid from", "issue date"],
  licenseExpiry: ["تاريخ الانتهاء", "تاريخ انتهاء الرخصة", "ينتهي في", "صالحة حتى", "expiry date", "valid until", "expiry"],
  firstRegistrationDate: ["تاريخ أول تسجيل", "أول تسجيل", "first registration", "first registered"],
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
// (e.g. "رقم الهيكل"/"رقم المحرك" never collide, and "الحمولة القصوى" beats "الحمولة").
type LabelEntry = { field: RegistrationFieldKey; label: string };
const LABEL_INDEX: LabelEntry[] = (Object.keys(REGISTRATION_LABELS) as RegistrationFieldKey[])
  .flatMap((field) => REGISTRATION_LABELS[field].map((label) => ({ field, label: label.toLowerCase() })))
  .sort((a, b) => b.label.length - a.label.length);

const PII_INDEX: string[] = [...REGISTRATION_PII_LABELS].map((l) => l.toLowerCase()).sort((a, b) => b.length - a.length);

const SEP_PREFIX = /^[\s:：\-–—.،]+/;

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
  const lower = cleaned.toLowerCase();

  // PII first — a line naming an owner/insurer/etc. is dropped even if it also happens to
  // contain a digit an operational label might otherwise grab.
  for (const pii of PII_INDEX) {
    if (pii.length > 0 && lower.includes(pii)) return { kind: "pii" };
  }

  for (const { field, label } of LABEL_INDEX) {
    const at = lower.indexOf(label);
    if (at < 0) continue;
    const afterStart = at + label.length;
    // Prefer the text AFTER the label; fall back to text BEFORE it (RTL layouts sometimes
    // place the value first). Capture from the ORIGINAL cleaned line to preserve glyphs/case.
    let after = cleaned.slice(afterStart).replace(SEP_PREFIX, "").trim();
    if (after.length === 0) {
      after = cleaned.slice(0, at).replace(SEP_PREFIX, "").replace(/[\s:：\-–—.،]+$/, "").trim();
    }
    if (after.length === 0) return { kind: "none" };
    return { kind: "field", field, rawValue: after };
  }
  return { kind: "none" };
}
