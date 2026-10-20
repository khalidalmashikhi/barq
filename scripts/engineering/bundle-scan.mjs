#!/usr/bin/env node
// BARQ client-bundle scan — run AFTER `npm run build`. Fails when anything that must stay on the
// server reaches the browser bundle (.next/static): credential-shaped values, server-only secret
// NAMES that no client code needs, or BARQ server-module markers.
//
//   node scripts/engineering/bundle-scan.mjs
//
// A positive control (a string every client build contains) guards against scanning an empty or
// stale directory and reporting a false "clean". Prints only file names and rule ids, never content.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { isMain, report } from "./lib.mjs";

const STATIC = path.join(".next", "static");

export const VALUE_RULES = [
  { id: "anthropic-key", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { id: "stripe-secret", re: /\b(?:sk|rk)_live_[0-9a-zA-Z]{16,}/ },
  { id: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: "db-url-with-password", re: /postgres(?:ql)?:\/\/[^:\s"'`/]+:[^@\s"'`]{8,}@/ },
];

// Server-only env NAMES. A library may legitimately reference an auth secret's NAME in a shared
// getter (Better Auth does, with no value) — so only names no client library touches are listed.
export const NAME_RULES = [
  "ANTHROPIC_API_KEY",
  "TRIP_PLANNER_AI_API_KEY",
  "LLM_GATEWAY_API_KEY",
  "TWILIO_AUTH_TOKEN",
  "RESEND_API_KEY",
  "CRON_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "REGISTRATION_OCR_PROVIDER",
];

// Server-only BARQ modules: if one of these identifiers is in a client chunk, a server module was
// imported into a client component.
export const SERVER_MARKERS = ["getTripCandidates", "TRIP_PUBLIC_SERVICE_GATE", "buildTripModelRequest", "api.anthropic.com", "claude-vision-reader", "PrismaClient"];

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(?:js|mjs|css|html|json|map)$/.test(e.name)) yield p;
  }
}

export function scanDir(dir) {
  const failures = [];
  let files = 0;
  let control = false;
  for (const f of walk(dir)) {
    if (statSync(f).size > 20 * 1024 * 1024) continue;
    files++;
    const text = readFileSync(f, "utf8");
    if (!control && text.includes("__next")) control = true;
    const rel = path.relative(".", f).replace(/\\/g, "/");
    for (const r of VALUE_RULES) if (r.re.test(text)) failures.push(`${rel} — ${r.id} (value not printed)`);
    for (const n of NAME_RULES) if (text.includes(n)) failures.push(`${rel} — server-only name ${n}`);
    for (const m of SERVER_MARKERS) if (text.includes(m)) failures.push(`${rel} — server-only module marker "${m}"`);
  }
  return { failures, files, control };
}

if (isMain(import.meta.url)) {
  if (!existsSync(STATIC)) {
    console.error("bundle-scan: .next/static not found — run `npm run build` first");
    process.exit(2);
  }
  const r = scanDir(STATIC);
  console.log(`bundle-scan: ${r.files} client file(s) in .next/static`);
  if (!r.control) r.failures.push("positive control missing (no Next.js runtime marker found) — the build output looks empty or stale");
  process.exit(report("bundle-scan", r.failures));
}
