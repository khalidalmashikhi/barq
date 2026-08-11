// Vercel staging bootstrap wrapper — testable core (ADR-0016 hardening).
//
// Operator tooling ONLY. It pulls the *existing, working* staging environment
// from Vercel (so nobody hand-builds a Supabase pooler URL again) and hands the
// exact DATABASE_URL / DIRECT_URL to the existing taxonomy bootstrap. It is
// deliberately dependency-injected: every side effect (reading the Vercel link,
// pulling env, reading/deleting the temp file, spawning the bootstrap, logging)
// is a passed-in function, so the whole flow is unit-tested with no real Vercel,
// Supabase, filesystem, or child process.
//
// It is NEVER wired into vercel-build, runtime, API routes, or cron — the thin
// entry (scripts/bootstrap-staging-taxonomy-vercel.ts) is only invoked by an
// operator via `npm run bootstrap-staging-taxonomy:vercel`.

export class VercelWrapperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VercelWrapperError";
  }
}

// The Vercel project this wrapper is allowed to target (team barq4).
export const STAGING_PROJECT_NAME = "barq-staging";

// Gitignored (matched by `.env.*.local`). Verified before implementation.
export const BOOTSTRAP_TEMP_ENV_FILE = ".env.barq-staging.bootstrap.local";

// The ONLY two keys ever read out of the pulled Vercel env file.
export type RequiredEnv = { DATABASE_URL: string; DIRECT_URL: string };

// Fail closed unless the workspace is linked to the staging project.
export function assertLinkedToStagingProject(projectJson: unknown): void {
  if (!projectJson || typeof projectJson !== "object") {
    throw new VercelWrapperError(
      "Vercel link missing or invalid (.vercel/project.json). Run `vercel link` to barq4/barq-staging."
    );
  }
  const name = (projectJson as { projectName?: unknown }).projectName;
  if (name !== STAGING_PROJECT_NAME) {
    throw new VercelWrapperError(
      `Vercel link is not the staging project (expected "${STAGING_PROJECT_NAME}"). Refusing to run.`
    );
  }
}

// Parse a dotenv-style file, returning ONLY DATABASE_URL / DIRECT_URL. Every
// other pulled variable (auth secrets, tokens, etc.) is deliberately ignored.
export function parseVercelEnvFile(contents: string): Partial<RequiredEnv> {
  const out: Partial<RequiredEnv> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    if (key !== "DATABASE_URL" && key !== "DIRECT_URL") continue; // read ONLY these two
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// Fail closed if either required var is absent — NEVER fall back to .env.
export function selectRequiredEnv(parsed: Partial<RequiredEnv>): RequiredEnv {
  if (!parsed.DATABASE_URL || parsed.DATABASE_URL.trim() === "") {
    throw new VercelWrapperError("Pulled Vercel env is missing DATABASE_URL — refusing (no fallback to .env).");
  }
  if (!parsed.DIRECT_URL || parsed.DIRECT_URL.trim() === "") {
    throw new VercelWrapperError("Pulled Vercel env is missing DIRECT_URL — refusing (no fallback to .env).");
  }
  return { DATABASE_URL: parsed.DATABASE_URL, DIRECT_URL: parsed.DIRECT_URL };
}

export function wantsApply(argv: readonly string[]): boolean {
  return argv.includes("--apply");
}

// Dry-run forwards NO extra args; --apply is forwarded explicitly.
export function buildBootstrapArgs(apply: boolean): string[] {
  return apply ? ["--apply"] : [];
}

// Child env for the spawned bootstrap: staging APP_ENV + the pulled DB target.
export function buildChildEnv(baseEnv: NodeJS.ProcessEnv, required: RequiredEnv): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    APP_ENV: "staging",
    DATABASE_URL: required.DATABASE_URL,
    DIRECT_URL: required.DIRECT_URL,
  };
}

export type VercelWrapperDeps = {
  readProjectJson: () => Promise<unknown>;
  vercelPull: (tempPath: string) => Promise<void>;
  readEnvFile: (tempPath: string) => Promise<string>;
  deleteTempFile: (tempPath: string) => Promise<void>;
  spawnBootstrap: (args: string[], childEnv: NodeJS.ProcessEnv) => Promise<number>;
  log: (message: string) => void;
  argv: readonly string[];
  baseEnv: NodeJS.ProcessEnv;
  tempPath: string;
};

// Orchestrates: verify link → pull env → read only DB/DIRECT → spawn bootstrap
// → always delete the temp secret file. Never logs any secret value.
export async function runVercelWrapper(deps: VercelWrapperDeps): Promise<number> {
  const { readProjectJson, vercelPull, readEnvFile, deleteTempFile, spawnBootstrap, log, argv, baseEnv, tempPath } =
    deps;

  // 1. Confirm the workspace is linked to the staging project (before anything).
  const projectJson = await readProjectJson();
  assertLinkedToStagingProject(projectJson);
  log(`Vercel link verified: ${STAGING_PROJECT_NAME}.`);

  const apply = wantsApply(argv);

  try {
    // 2. Pull the staging env (production scope) into the temp file — never printed.
    log("Pulling staging environment from Vercel (production scope)...");
    await vercelPull(tempPath);

    // 3. Read ONLY DATABASE_URL / DIRECT_URL; fail closed if either is absent.
    const contents = await readEnvFile(tempPath);
    const required = selectRequiredEnv(parseVercelEnvFile(contents));
    log("Pulled DATABASE_URL and DIRECT_URL (values hidden).");

    // 4. Spawn the existing bootstrap with the injected staging env.
    const childEnv = buildChildEnv(baseEnv, required);
    const args = buildBootstrapArgs(apply);
    log(apply ? "Running taxonomy bootstrap: APPLY." : "Running taxonomy bootstrap: DRY-RUN.");
    return await spawnBootstrap(args, childEnv);
  } finally {
    // 5. Always remove the temp secret file (success, failure, or throw).
    await deleteTempFile(tempPath).catch(() => {});
    log("Temporary env file removed.");
  }
}
