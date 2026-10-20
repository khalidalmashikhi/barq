#!/usr/bin/env node
// BARQ secret scan — fails when a change ADDS a credential-shaped value or a credential FILE.
//
//   node scripts/engineering/secret-scan.mjs --staged            (pre-commit)
//   node scripts/engineering/secret-scan.mjs --range A..B        (pre-push: every commit in A..B)
//   node scripts/engineering/secret-scan.mjs --base origin/staging   (CI: every commit of the PR)
//
// With --range / --base EVERY COMMIT is scanned on its own, so a secret added in one commit and
// removed in a later one is still caught (it would remain in history). Findings print file, line
// and rule only — never the value. Complements (does not replace) GitHub secret scanning + push
// protection, which are enabled on the repository. A deliberate, reviewed false positive can be
// suppressed on its own line with the marker `secret-scan:allow`.

import { git, isMain, parseArgs, report } from "./lib.mjs";

const RULES = [
  { id: "anthropic-key", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { id: "openai-key", re: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/ },
  { id: "stripe-live-key", re: /\b(?:sk|rk)_live_[0-9a-zA-Z]{16,}\b/ },
  { id: "stripe-webhook-secret", re: /\bwhsec_[A-Za-z0-9]{20,}\b/ },
  { id: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "github-token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/ },
  { id: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: "twilio-api-key", re: /\bSK[0-9a-f]{32}\b/ },
  { id: "resend-key", re: /\bre_[A-Za-z0-9]*\d[A-Za-z0-9_]{20,}\b/ },
  { id: "private-key", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/ },
  { id: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
];

// postgres://user:password@host — flagged unless clearly a local / placeholder value.
const CONN = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss):\/\/([^:\s/@]+):([^@\s]+)@([^/\s:?]+)/;
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|db|postgres|host|example\.com|.*\.example(?:\.com)?)$/i;
const PLACEHOLDER = /placeholder|example|changeme|dummy|fake|redacted|xxx|<[^>]+>|\$\{|ci[-_]|test|password|secret|^pass$|^postgres$|^ci$/i;

// NAME = value assignments of something that looks like a real credential.
const ASSIGN = /\b([A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|AUTH_TOKEN))\s*[:=]\s*["'`]?([A-Za-z0-9/+_=.-]{24,})/;

const FORBIDDEN_FILE = [
  { id: "env-file", re: /(^|\/)\.env(?!\.example$)(\.[^/]*)?$/ },
  { id: "key-material", re: /\.(?:pem|p12|pfx|jks|keystore)$|(^|\/)id_(?:rsa|ed25519|ecdsa)$/ },
  { id: "vercel-link", re: /(^|\/)\.vercel\// },
  { id: "claude-local-settings", re: /(^|\/)\.claude\/settings\.local\.json$/ },
  { id: "session-pool", re: /scripts\/load-test\/\.session-pool\.json$/ },
];

function scanLine(text) {
  if (text.includes("secret-scan:allow")) return null;
  for (const r of RULES) if (r.re.test(text)) return r.id;
  const c = text.match(CONN);
  if (c && c[2].length >= 8 && !LOCAL_HOST.test(c[3]) && !PLACEHOLDER.test(c[2])) return "connection-string-with-password"; // short = test fixture
  const a = text.match(ASSIGN);
  if (a && !PLACEHOLDER.test(a[2]) && /\d/.test(a[2]) && /[A-Za-z]/.test(a[2])) return "credential-assignment";
  return null;
}

/** Added lines + added/modified file paths of ONE patch (git show / git diff output). */
function parsePatch(patch) {
  const lines = [];
  const files = new Set();
  let file = null;
  let n = 0;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("+++ ")) {
      file = raw === "+++ /dev/null" ? null : raw.replace(/^\+\+\+ b\//, "");
      if (file) files.add(file);
      continue;
    }
    const h = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) {
      n = Number(h[1]);
      continue;
    }
    if (file && raw.startsWith("+") && !raw.startsWith("+++")) {
      lines.push({ path: file, line: n, text: raw.slice(1) });
      n++;
    }
  }
  return { lines, files: [...files] };
}

function scanPatch(label, patch, failures, seen) {
  const { lines, files } = parsePatch(patch);
  for (const f of files)
    for (const r of FORBIDDEN_FILE)
      if (r.re.test(f) && !seen.has(`file:${f}`)) {
        seen.add(`file:${f}`);
        failures.push(`${label}: ${f} — ${r.id} must never be committed`);
      }
  for (const l of lines) {
    if (/\.(?:png|jpe?g|gif|webp|ico|woff2?|pdf|lock)$/i.test(l.path) || l.path === "package-lock.json") continue;
    const rule = scanLine(l.text);
    const key = `${l.path}:${l.line}:${rule}`;
    if (rule && !seen.has(key)) {
      seen.add(key);
      failures.push(`${label}: ${l.path}:${l.line} — ${rule} (value not printed)`);
    }
  }
}

export function scan(args) {
  const failures = [];
  const seen = new Set();
  if (args.staged) {
    scanPatch("staged", git(["diff", "--cached", "--unified=0", "--no-color", "--no-renames"]), failures, seen);
    return { label: "staged changes", failures, commits: 0 };
  }
  const range = typeof args.range === "string" ? args.range : typeof args.base === "string" ? `${args.base}..HEAD` : null;
  if (!range) throw new Error("specify --staged, --range A..B or --base REF");
  const shas = git(["rev-list", "--reverse", "--no-merges", range]).split("\n").filter(Boolean);
  // a PR / push always adds at least one commit — zero means a wrong base, never "clean"
  if (args["require-commits"] && shas.length === 0) failures.push(`no commits found in ${range} — wrong base ref; refusing to report a clean scan`);
  for (const sha of shas) scanPatch(sha.slice(0, 7), git(["show", "--unified=0", "--no-color", "--no-renames", "--format=", sha]), failures, seen);
  // plus the NET diff of the whole range: catches content introduced by a merge commit (whose own
  // patch the per-commit pass above skips)
  const [from, to] = range.includes("...") ? range.split("...") : range.split("..");
  scanPatch("range", git(["diff", "--unified=0", "--no-color", "--no-renames", `${from}...${to || "HEAD"}`]), failures, seen);
  return { label: range, failures, commits: shas.length };
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const r = scan(args);
    console.log(`secret-scan over ${r.label}${r.commits ? ` (${r.commits} commit${r.commits > 1 ? "s" : ""}, each scanned)` : ""}`);
    process.exit(report("secret-scan", r.failures));
  } catch (e) {
    console.error(`secret-scan: ${e.message}`);
    process.exit(2);
  }
}

export { scanLine };
