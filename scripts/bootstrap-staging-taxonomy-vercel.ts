import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import {
  runVercelWrapper,
  VercelWrapperError,
  BOOTSTRAP_TEMP_ENV_FILE,
} from "../src/lib/staging-ops/vercel-taxonomy-wrapper";

// BARQ v1 staging taxonomy bootstrap — VERCEL WRAPPER (ADR-0016 hardening).
//
// Operator convenience: pulls the *existing, working* staging env from Vercel
// (exact Supabase pooler DATABASE_URL/DIRECT_URL — no hand-built URLs) and runs
// the existing taxonomy bootstrap against it. DRY-RUN by default; pass --apply
// to forward it. The temp env file is gitignored and deleted afterward.
//
// USAGE:
//   npm run bootstrap-staging-taxonomy:vercel            # dry-run
//   npm run bootstrap-staging-taxonomy:vercel -- --apply # execute
//
// NOT wired into vercel-build / runtime / API routes / cron — operator tooling only.

const tempPath = path.resolve(process.cwd(), BOOTSTRAP_TEMP_ENV_FILE);
const projectJsonPath = path.resolve(process.cwd(), ".vercel", "project.json");
const isWindows = process.platform === "win32";

// Prefer a globally-installed `vercel`; otherwise use `npx vercel` — never add
// Vercel as a project dependency.
function resolveVercelInvocation(): { command: string; prefix: string[] } {
  try {
    const probe = spawnSync("vercel", ["--version"], { stdio: "ignore", shell: isWindows });
    if (probe.status === 0) return { command: "vercel", prefix: [] };
  } catch {
    // fall through to npx
  }
  return { command: isWindows ? "npx.cmd" : "npx", prefix: ["--yes", "vercel"] };
}

async function realVercelPull(target: string): Promise<void> {
  const { command, prefix } = resolveVercelInvocation();
  const args = [...prefix, "env", "pull", target, "--environment=production", "--yes"];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: isWindows });
    child.on("error", () =>
      reject(
        new VercelWrapperError(
          "Vercel CLI unavailable. Install it (`npm i -g vercel`) and log in (`vercel login`). Not falling back to .env."
        )
      )
    );
    child.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new VercelWrapperError(
            "`vercel env pull` failed. Ensure you are logged in (`vercel login`) and the repo is linked to " +
              "barq4/barq-staging (`vercel link`). Not falling back to .env."
          )
        );
    });
  });
}

function realSpawnBootstrap(args: string[], childEnv: NodeJS.ProcessEnv): Promise<number> {
  const npm = isWindows ? "npm.cmd" : "npm";
  const fullArgs = ["run", "bootstrap-staging-taxonomy", ...(args.length ? ["--", ...args] : [])];
  return new Promise<number>((resolve, reject) => {
    const child = spawn(npm, fullArgs, { stdio: "inherit", env: childEnv, shell: isWindows });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function cleanupTemp(): Promise<void> {
  await fs.rm(tempPath, { force: true }).catch(() => {});
}

// Best-effort cleanup if the operator cancels mid-run.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void cleanupTemp().finally(() => process.exit(130));
  });
}

async function main() {
  const code = await runVercelWrapper({
    readProjectJson: async () => {
      try {
        return JSON.parse(await fs.readFile(projectJsonPath, "utf8"));
      } catch {
        throw new VercelWrapperError(
          "Vercel link not found (.vercel/project.json). Run `vercel link` to barq4/barq-staging."
        );
      }
    },
    vercelPull: realVercelPull,
    readEnvFile: (p) => fs.readFile(p, "utf8"),
    deleteTempFile: cleanupTemp,
    spawnBootstrap: realSpawnBootstrap,
    log: (message) => console.log(`[vercel-staging] ${message}`),
    argv: process.argv.slice(2),
    baseEnv: process.env,
    tempPath,
  });
  process.exitCode = code;
}

main().catch((error) => {
  if (error instanceof VercelWrapperError) console.error(error.message);
  else console.error("bootstrap-staging-taxonomy-vercel failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
