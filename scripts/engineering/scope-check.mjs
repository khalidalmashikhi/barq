#!/usr/bin/env node
// BARQ prohibited-scope check.
//
//   node scripts/engineering/scope-check.mjs --staged
//   node scripts/engineering/scope-check.mjs --base origin/staging
//   node scripts/engineering/scope-check.mjs --range A..B --forbid payment,booking,pricing
//
// FAILS on artefacts that must never be committed: build output, logs, scratch / temporary files,
// screenshots or documents outside the public asset folders (a real registration document, an
// unredacted screenshot), local agent settings.
//
// REPORTS every touched SENSITIVE AREA (schema, migrations, auth, payment, booking writes, pricing,
// rental calendar, registration reading / consent, CI, deploy config, env validation). Sensitive
// areas are allowed — they are normal work — but they must be named in the task's scope. A task
// whose hard stop excludes an area passes `--forbid <area,...>` and the check then FAILS if the
// change touches it.

import { changedFiles, isMain, parseArgs, report, resolveChangeSet } from "./lib.mjs";

export const PROHIBITED = [
  { id: "build-output", re: /^(?:\.next|out|dist|build|coverage|\.turbo|\.vercel)\// },
  { id: "dependencies", re: /(^|\/)node_modules\// },
  { id: "log-file", re: /\.log$/i },
  { id: "tsbuildinfo", re: /\.tsbuildinfo$/ },
  { id: "scratch-or-temp", re: /(^|\/)(?:scratchpad|tmp|temp)\/|(^|\/)_tmp|\.tmp\.|(^|\/)tmp-[^/]+\/|(^|\/)[^/]*\.bak$/i },
  { id: "agent-local-settings", re: /^\.claude\/(?:settings\.local\.json|launch\.json|worktrees\/)/ },
  { id: "env-file", re: /(^|\/)\.env(?!\.example$)(\.[^/]*)?$/ },
  // Images / documents only inside the public asset folders and Next.js app icons.
  { id: "image-or-document-outside-public", re: /\.(?:png|jpe?g|webp|gif|heic|heif|tiff?|bmp|pdf)$/i, unless: /^(?:public\/|src\/app\/[^/]+\.(?:png|ico|jpg)$)/ },
];

export const SENSITIVE_AREAS = [
  { id: "schema", re: /^prisma\/schema\.prisma$/ },
  { id: "migration", re: /^prisma\/migrations\// },
  { id: "auth", re: /^src\/(?:lib\/auth\/|middleware\.ts$|app\/api\/auth\/)|rbac/ },
  { id: "payment", re: /payment|stripe|webhooks\/payments|refund|invoice|commission/i },
  { id: "booking", re: /^src\/(?:lib\/booking\/|app\/api\/(?:v1\/)?(?:me\/)?bookings?\/)/ },
  { id: "pricing", re: /pric(?:e|ing)/i },
  { id: "rental-calendar", re: /rental/i },
  { id: "registration-reading", re: /registration-extraction|registration-review|ocr|consent/i },
  { id: "provider-documents", re: /provider-document|provider\/documents/ },
  { id: "ci-workflow", re: /^\.github\// },
  { id: "deploy-config", re: /^(?:vercel\.json|next\.config\.[a-z]+|package\.json|package-lock\.json)$/ },
  { id: "env-validation", re: /^scripts\/(?:validate-env|env-schema)\.ts$/ },
  { id: "agent-config", re: /^(?:CLAUDE\.md|AGENTS\.md|\.claude\/)/ },
];

export function classify(paths, forbid = []) {
  const failures = [];
  const touched = new Map();
  for (const p of paths) {
    for (const r of PROHIBITED) if (r.re.test(p) && !(r.unless && r.unless.test(p))) failures.push(`${p} — ${r.id} must not be committed`);
    for (const a of SENSITIVE_AREAS) if (a.re.test(p)) touched.set(a.id, [...(touched.get(a.id) ?? []), p]);
  }
  for (const area of forbid) if (touched.has(area)) failures.push(`area "${area}" is out of scope for this task but is touched: ${touched.get(area).slice(0, 5).join(", ")}${touched.get(area).length > 5 ? " …" : ""}`);
  return { failures, touched };
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const { label, diffArgs } = resolveChangeSet(args);
    const files = changedFiles(diffArgs).filter((f) => f.status !== "D");
    const forbid = typeof args.forbid === "string" ? args.forbid.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const unknown = forbid.filter((f) => !SENSITIVE_AREAS.some((a) => a.id === f));
    if (unknown.length) throw new Error(`unknown --forbid area(s): ${unknown.join(", ")} (known: ${SENSITIVE_AREAS.map((a) => a.id).join(", ")})`);
    const { failures, touched } = classify(files.map((f) => f.path), forbid);
    console.log(`scope-check over ${label}: ${files.length} added/modified file(s)`);
    if (touched.size === 0) console.log("  sensitive areas touched: none");
    for (const [area, ps] of touched) console.log(`  sensitive area touched: ${area} (${ps.length}) — must be named in the task scope`);
    process.exit(report("scope-check", failures));
  } catch (e) {
    console.error(`scope-check: ${e.message}`);
    process.exit(2);
  }
}
