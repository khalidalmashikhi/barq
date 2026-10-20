import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-expect-error — plain .mjs guard modules (no type declarations by design: zero-dependency Node)
import { decide } from "../../.claude/hooks/guard-bash.mjs";
// @ts-expect-error — see above
import { scanLine } from "./secret-scan.mjs";
// @ts-expect-error — see above
import { classify } from "./scope-check.mjs";
// @ts-expect-error — see above
import { checkChanges, destructiveStatements } from "./check-migrations.mjs";
// @ts-expect-error — see above
import { checkNamespace, icuArgs } from "./translation-parity.mjs";
// @ts-expect-error — see above
import { evaluate } from "./prepush-check.mjs";
// @ts-expect-error — see above
import { parseBuildLog, parseInspect, PROJECTS } from "./verify-deploy.mjs";

// 2026-10-20 — Engineering workflow hardening: the Claude Code guard hook and the CI / local guard
// scripts. Fake credentials are ASSEMBLED AT RUNTIME so neither GitHub push protection nor the
// repository's own secret scan ever sees a credential-shaped literal in this file.
const fake = {
  anthropic: ["sk", "ant", "api03", "x".repeat(40)].join("-"),
  aws: "AKIA" + "ABCDEFGHIJKLMNOP",
  privateKey: ["-----BEGIN", "RSA PRIVATE KEY-----"].join(" "),
  dbUrl: "postgresql://" + "app_user:" + "Zr8vLq2Nw4" + "@db.prod-cluster.internal:5432/barq",
};

describe("guard hook — always blocked", () => {
  it.each([
    ["claude --dangerously-skip-permissions", /prohibited/],
    ["git push --force origin staging", /Force/],
    ["git push -f", /Force/],
    ["git push origin +staging", /Force/],
    ["git push origin :old-branch", /Force|deleting/],
    ["git push origin main", /main\/master/],
    ["git push origin HEAD:main", /main\/master/],
    ["git push --no-verify", /no-verify/],
    ["git reset --hard HEAD~1", /reset --hard/],
    ["git clean -fd", /clean/],
    ["git checkout -- .", /Discarding/],
    ["git restore src/app/page.tsx", /discards/],
    ["git branch -D feature/x", /branch -D/],
    ["git commit --amend --no-edit", /Amending/],
    ["git rebase -i HEAD~3", /History rewriting/],
    ["git config --list", /credential/],
    ["npx vercel --prod", /Production deployment/],
    ["npx vercel deploy --prod", /Production deployment/],
    ["vercel promote dpl_x", /owner-only/],
    ["npx vercel rollback", /owner-only/],
    ["npx vercel alias set a b", /owner-only/],
    ["npx vercel env pull .env.local", /vercel env/],
    ["npx vercel env ls", /vercel env/],
    ["npx vercel deploy", /do not deploy/],
    ["npx vercel api /v9/projects/barq -X DELETE", /read-only/],
    ["printenv", /environment variables/],
    ["env", /environment variables/],
    ["set", /environment variables/],
    ["cat .env", /\.env files/],
    ["grep DATABASE .env.local", /\.env files/],
    ['echo "$DATABASE_URL"', /secret-bearing/],
    ["echo ${BETTER_AUTH_SECRET}", /secret-bearing/],
    ["Write-Output $env:ANTHROPIC_API_KEY", /secret-bearing/],
    ["gh secret set ANTHROPIC_API_KEY", /owner-only/],
    ["gh auth token", /owner-only/],
    ["rm -rf /", /Recursive deletion/],
    ["rm -rf ~", /Recursive deletion/],
    ["rm -rf src", /Recursive deletion/],
    ["rm -rf .", /Recursive deletion/],
    ["Remove-Item -Recurse -Force prisma", /Recursive deletion/],
    ["npx prisma migrate reset --force", /reset/],
    ["npx prisma db push --accept-data-loss", /data-loss/],
    ['psql "$URL" -c "DELETE FROM bookings"', /Direct database deletion/],
    ['node -e "prisma.booking.deleteMany({})"', /Inline scripts/],
    ["npm test && git push --force", /Force/], // compound: any segment
  ])("%s", (cmd, reason) => {
    const d = decide(cmd);
    expect(d.action, cmd).toBe("block");
    expect(d.reason).toMatch(reason);
  });
});

describe("guard hook — routine work is not blocked", () => {
  it.each([
    "git status --porcelain",
    "git log --oneline -5",
    "git diff --check",
    "git fetch origin",
    "git restore --staged src/a.ts",
    "npm run typecheck",
    "npx tsc --noEmit -p .",
    "npx vitest run src/lib/trips",
    "npm run build",
    "npx prisma validate",
    "npx vercel inspect barq-staging.vercel.app --logs",
    "npx vercel ls barq-staging",
    "npx vercel api /v9/projects/barq",
    "rm -rf .next",
    'rm -rf "src/app/[locale]/tmp-booking-en-check"',
    "rm -f notes.txt",
    "grep -n KEY .env.example",
    "set -e",
    'echo "exit:$?"',
    'echo "  secret-scan exit=${PIPESTATUS[0]}"', // the word "secret" is not a secret-bearing variable
    'echo "token count: $COUNT"',
    "env NODE_ENV=production npx tsx scripts/validate-env.ts",
  ])("%s", (cmd) => {
    expect(decide(cmd).action, cmd).toBe("pass");
  });

  it("commit and push are routed to their gates (not silently allowed)", () => {
    expect(decide('git commit -m "x"')).toEqual({ action: "commit" });
    expect(decide("git push origin staging")).toEqual({ action: "push", target: "staging" });
    expect(decide("git push origin HEAD:refs/heads/feat/x")).toEqual({ action: "push", target: "feat/x" });
  });
});

describe("secret scan — detects credential shapes, ignores placeholders", () => {
  it("flags real-looking credentials", () => {
    expect(scanLine(`key = "${fake.anthropic}"`)).toBe("anthropic-key");
    expect(scanLine(`id=${fake.aws}`)).toBe("aws-access-key");
    expect(scanLine(fake.privateKey)).toBe("private-key");
    expect(scanLine(`DATABASE_URL="${fake.dbUrl}"`)).toBe("connection-string-with-password");
  });
  it("passes placeholders, local URLs, short fixtures and the explicit allow marker", () => {
    expect(scanLine('DATABASE_URL: "postgresql://ci:ci@localhost:5432/ci"')).toBeNull();
    expect(scanLine('BETTER_AUTH_SECRET: "ci-placeholder-secret-at-least-32-characters-long"')).toBeNull();
    expect(scanLine("`postgresql://postgres.ref:pw@aws-1-ap-south-1.pooler.supabase.com:6543/postgres`")).toBeNull();
    expect(scanLine(`x = "${fake.anthropic}" // secret-scan:allow`)).toBeNull();
  });
});

describe("scope check", () => {
  it("fails on build output, logs, scratch files, local agent settings, env files and stray images", () => {
    const { failures } = classify([".next/static/a.js", "debug.log", "scratchpad/x.mjs", ".claude/settings.local.json", ".env.local", "docs/shot.png", "src/app/[locale]/tmp-check/page.tsx"]);
    expect(failures).toHaveLength(7);
  });
  it("public assets and app icons are fine; sensitive areas are reported, and fail only when forbidden", () => {
    expect(classify(["public/images/hero.jpg", "src/app/icon.png"]).failures).toEqual([]);
    const r = classify(["prisma/schema.prisma", "src/lib/booking/create-booking.ts", "src/lib/trips/trip-plan.ts"], ["payment"]);
    expect([...r.touched.keys()].sort()).toEqual(["booking", "schema"]);
    expect(r.failures).toEqual([]);
    expect(classify(["src/lib/booking/create-booking.ts"], ["booking"]).failures[0]).toMatch(/out of scope/);
  });
});

describe("migration integrity", () => {
  const base = new Set(["20260706191113_init", "20260925120000_registration_ocr_consent"]);
  it("an existing migration may never be modified or deleted; the lock never changes", () => {
    expect(checkChanges([{ status: "M", path: "prisma/migrations/20260706191113_init/migration.sql" }], base).failures[0]).toMatch(/immutable/);
    expect(checkChanges([{ status: "D", path: "prisma/migrations/20260706191113_init/migration.sql" }], base).failures[0]).toMatch(/deleted/);
    expect(checkChanges([{ status: "M", path: "prisma/migrations/migration_lock.toml" }], base).failures[0]).toMatch(/lock/);
  });
  it("a base with no migrations yet treats every migration as new (first migration ever)", () => {
    expect(checkChanges([{ status: "A", path: "prisma/migrations/20260706191113_init/migration.sql" }], new Set())).toMatchObject({ failures: [], added: ["20260706191113_init"] });
  });

  it("a new migration must sort after the existing ones", () => {
    expect(checkChanges([{ status: "A", path: "prisma/migrations/20261101120000_new_thing/migration.sql" }], base)).toMatchObject({ failures: [], added: ["20261101120000_new_thing"] });
    expect(checkChanges([{ status: "A", path: "prisma/migrations/20260101120000_backdated/migration.sql" }], base).failures[0]).toMatch(/out of order/);
  });
  it("statements a code rollback cannot undo are recognised (comments ignored)", () => {
    expect(destructiveStatements('ALTER TABLE "User" DROP COLUMN "x";')).toEqual(["DROP"]);
    expect(destructiveStatements('ALTER TABLE "a" ALTER COLUMN "b" SET DATA TYPE TEXT;')).toEqual(["TYPE CHANGE"]);
    expect(destructiveStatements('UPDATE "Slot" SET "state" = \'OPEN\';')).toEqual(["DATA REWRITE"]);
    expect(destructiveStatements('-- DROP TABLE "x"\nCREATE TABLE "y" ("id" TEXT);')).toEqual([]);
  });
});

describe("translation parity", () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "barq-parity-"));
    const write = (l: string, v: object) => {
      mkdirSync(path.join(root, l), { recursive: true });
      writeFileSync(path.join(root, l, "ns.json"), JSON.stringify(v));
    };
    for (const l of ["ar", "en", "de", "it", "pl", "fr", "cs"]) write(l, { a: { b: "x {count}" }, c: "y" });
    write("ru", { a: { b: "x {n}" }, c: "" , extra: "z" });
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  it("reports extra keys, empty values and ICU-argument drift; a missing locale file is reported", () => {
    const f = checkNamespace(root, "ns").join("\n");
    expect(f).toMatch(/ru\/ns: 1 key\(s\) not in en/);
    expect(f).toMatch(/ru\/ns\.c is empty/);
    expect(f).toMatch(/ru\/ns\.a\.b: ICU arguments \{n\} differ from en \{count\}/);
    expect(checkNamespace(root, "missing")[0]).toMatch(/missing/);
    expect(icuArgs("{count, plural, one {# day} other {# days}} in {region}")).toEqual(["count", "region"]);
  });
});

describe("pre-push gate", () => {
  const ok = { branch: "feat/x", target: "feat/x", dirty: [], remoteSha: "a".repeat(40), localSha: "b".repeat(40), remoteIsAncestor: true, localHasRemote: true };
  it("passes a clean fast-forward and refuses main, dirty trees, drift and no-ops", () => {
    expect(evaluate(ok)).toEqual([]);
    expect(evaluate({ ...ok, target: "main" })[0]).toMatch(/production branch/);
    expect(evaluate({ ...ok, dirty: ["src/a.ts"] })[0]).toMatch(/not clean/);
    expect(evaluate({ ...ok, localHasRemote: false })[0]).toMatch(/REMOTE DRIFT/);
    expect(evaluate({ ...ok, localSha: ok.remoteSha })[0]).toMatch(/nothing to push/);
  });
});

describe("post-deploy verification parsing", () => {
  it("reads the deployment, the cloned commit and the migration result from Vercel CLI output", () => {
    expect(parseInspect("  General\n    id\t\tdpl_ABC\n    target\tproduction\n    status\t● Ready\n    url\t\thttps://barq-staging-x-barq4.vercel.app\n")).toEqual({ id: "dpl_ABC", target: "production", status: "Ready", url: "https://barq-staging-x-barq4.vercel.app" });
    expect(parseBuildLog("Cloning github.com/o/r (Branch: staging, Commit: bea4585)\n66 migrations found in prisma/migrations\nNo pending migrations to apply.")).toEqual({ branch: "staging", sha: "bea4585", migrationsFound: 66, migrationResult: "NONE_PENDING" });
    expect(parseBuildLog("Error: P3009 migrate found failed migrations").migrationResult).toBe("FAILED");
  });
  it("staging and production are distinct, named projects", () => {
    expect(PROJECTS["barq-staging"].alias).toBe("barq-staging.vercel.app");
    expect(PROJECTS.barq.label).toMatch(/PRODUCTION/);
  });
});

describe("secret scan over a fixture repository — every commit is scanned on its own", () => {
  let repo: string;
  const g = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8" });
  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), "barq-secret-"));
    g("init", "-q");
    g("config", "user.email", "fixture@example.com");
    g("config", "user.name", "fixture");
    g("config", "commit.gpgsign", "false");
    writeFileSync(path.join(repo, "a.ts"), "export const a = 1;\n");
    g("add", ".");
    g("commit", "-qm", "base");
    writeFileSync(path.join(repo, "a.ts"), `export const k = "${fake.anthropic}";\n`);
    g("commit", "-qam", "adds a key");
    writeFileSync(path.join(repo, "a.ts"), "export const a = 1;\n");
    g("commit", "-qam", "removes it again");
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));
  it("a secret added then removed is still caught; the value is never printed", () => {
    const script = path.resolve("scripts/engineering/secret-scan.mjs");
    const r = spawnSync(process.execPath, [script, "--range", "HEAD~2..HEAD"], { cwd: repo, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/a\.ts:1 — anthropic-key/);
    expect(r.stdout).not.toContain(fake.anthropic.slice(8));
    const clean = spawnSync(process.execPath, [script, "--range", "HEAD~1..HEAD"], { cwd: repo, encoding: "utf8" });
    expect(clean.status).toBe(0);
  });
});
