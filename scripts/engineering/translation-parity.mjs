#!/usr/bin/env node
// BARQ translation parity — fast (no test runner) key-set check across the 8 locales (ADR-0010).
//
//   node scripts/engineering/translation-parity.mjs                 every namespace
//   node scripts/engineering/translation-parity.mjs messages/ar/trips.json   only that file's namespace
//
// For every namespace file messages/<locale>/<ns>.json: the same file exists in all 8 locales, the
// flattened key sets are identical to English, no value is empty, and each value uses the same ICU
// argument names as English (a missing {count} would render a raw placeholder). The full rules
// (namespace registration, completeness) stay in src/lib/i18n/translation-completeness.test.ts —
// this script is the quick guard run after a locale file is edited, and in CI.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isMain, report } from "./lib.mjs";

export const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"];

export function flatten(obj, prefix = "", out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}

/** ICU argument names in a message: {name}, {count, plural, ...}; nested branches are scanned too. */
export function icuArgs(value) {
  if (typeof value !== "string") return [];
  const names = new Set();
  for (const m of value.matchAll(/\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:[,}])/g)) names.add(m[1]);
  return [...names].sort();
}

export function checkNamespace(root, ns) {
  const failures = [];
  const load = (l) => {
    const f = path.join(root, l, `${ns}.json`);
    if (!existsSync(f)) {
      failures.push(`messages/${l}/${ns}.json is missing`);
      return null;
    }
    try {
      return flatten(JSON.parse(readFileSync(f, "utf8")));
    } catch (e) {
      failures.push(`messages/${l}/${ns}.json is not valid JSON (${e.message.split("\n")[0]})`);
      return null;
    }
  };
  const en = load("en");
  if (!en) return failures;
  for (const l of LOCALES) {
    const m = l === "en" ? en : load(l);
    if (!m) continue;
    const missing = [...en.keys()].filter((k) => !m.has(k));
    const extra = [...m.keys()].filter((k) => !en.has(k));
    if (missing.length) failures.push(`${l}/${ns}: ${missing.length} key(s) missing vs en — ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? " …" : ""}`);
    if (extra.length) failures.push(`${l}/${ns}: ${extra.length} key(s) not in en — ${extra.slice(0, 4).join(", ")}${extra.length > 4 ? " …" : ""}`);
    for (const [k, v] of m) {
      if (typeof v === "string" && v.trim() === "") failures.push(`${l}/${ns}.${k} is empty`);
      if (l !== "en" && en.has(k)) {
        const a = icuArgs(en.get(k)).join(",");
        const b = icuArgs(v).join(",");
        if (a !== b) failures.push(`${l}/${ns}.${k}: ICU arguments {${b}} differ from en {${a}}`);
      }
    }
  }
  return failures;
}

export function namespaces(root) {
  const set = new Set();
  for (const l of LOCALES) {
    const d = path.join(root, l);
    if (existsSync(d)) for (const f of readdirSync(d)) if (f.endsWith(".json")) set.add(f.slice(0, -5));
  }
  return [...set].sort();
}

if (isMain(import.meta.url)) {
  const root = "messages";
  const only = process.argv.slice(2).map((p) => p.replace(/\\/g, "/").match(/messages\/[a-z]{2}\/([^/]+)\.json$/)?.[1]).filter(Boolean);
  const list = only.length ? [...new Set(only)] : namespaces(root);
  const failures = list.flatMap((ns) => checkNamespace(root, ns));
  console.log(`translation-parity: ${list.length} namespace(s) × ${LOCALES.length} locales`);
  process.exit(report("translation-parity", failures));
}
